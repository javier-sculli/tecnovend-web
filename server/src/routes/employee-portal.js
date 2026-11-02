import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { 
  createAndSendOtp, 
  verifyOtpAndCreateSession, 
  getEmployeeBySessionToken, 
  revokeEmployeeSession 
} from '../services/employee-auth.js';
import { requireEmployeeAuth } from '../middleware/employee-auth.js';
import { createPreference } from '../services/mp.js';
import { fulfillEmployeePaymentIntent } from '../services/employee-discounts.js';

const router = Router();

// Helper para extraer token de cookie / header
function getReqToken(req) {
  if (req.cookies && req.cookies.emp_session) return req.cookies.emp_session;
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    const match = rawCookie.match(/(?:^|;\s*)emp_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers['x-employee-token'] || null;
}

// ─── 1. Información pública de la máquina para la webapp de empleados ───────────
router.get('/machine/:machineId', async (req, res) => {
  try {
    const { machineId } = req.params;
    const row = await db.prepare(`
      SELECT m.id, m.name, m.location, m.status, m.pulse_value, m.min_payment,
             m.qr_mode, m.qr_fixed_amount, m.employee_discount_enabled, m.last_seen_at,
             m.client_id, c.name as client_name, c.default_discount_pct, c.employee_discounts_enabled
      FROM machines m
      LEFT JOIN clients c ON c.id = m.client_id
      WHERE m.id = ?
    `).get(machineId);

    if (!row) {
      return res.status(404).json({ error: 'Máquina no encontrada' });
    }

    // Comprobar si la máquina está online (reportó en los últimos 5 minutos)
    const isOnline = row.last_seen_at 
      ? (Date.now() - new Date(row.last_seen_at.replace(' ', 'T') + (row.last_seen_at.includes('Z') ? '' : 'Z')).getTime()) < 5 * 60 * 1000
      : false;

    const discountEnabled = Boolean(row.employee_discount_enabled && row.employee_discounts_enabled);

    res.json({
      id: row.id,
      name: row.name,
      location: row.location || '',
      status: row.status,
      isOnline,
      clientId: row.client_id,
      clientName: row.client_name || null,
      employeeDiscountEnabled: discountEnabled,
      defaultDiscountPct: row.default_discount_pct ?? 20,
      qrMode: row.qr_mode,
      fixedAmount: row.qr_fixed_amount ? Number(row.qr_fixed_amount) : null,
      pulseValue: row.pulse_value ? Number(row.pulse_value) : 200,
      minPayment: row.min_payment ? Number(row.min_payment) : 200,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. Solicitar código OTP al mail ───────────────────────────────────────────
router.post('/auth/request-otp', async (req, res) => {
  try {
    const { machineId, email } = req.body || {};
    if (!machineId || !email) {
      return res.status(400).json({ error: 'machineId y email son requeridos' });
    }

    const machine = await db.prepare('SELECT client_id, employee_discount_enabled FROM machines WHERE id = ?').get(machineId);
    if (!machine || !machine.client_id) {
      return res.status(404).json({ error: 'Máquina no encontrada o sin cliente asignado' });
    }

    if (!machine.employee_discount_enabled) {
      return res.status(403).json({ error: 'El beneficio para empleados no está activo en esta máquina' });
    }

    const result = await createAndSendOtp(machine.client_id, email);
    res.json({
      ok: true,
      message: 'Te enviamos un código de 4 dígitos a tu correo',
      mailSent: result.mailSent,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── 3. Verificar OTP y emitir sesión (180 días) ──────────────────────────────
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { machineId, email, code } = req.body || {};
    if (!machineId || !email || !code) {
      return res.status(400).json({ error: 'machineId, email y code son requeridos' });
    }

    const machine = await db.prepare('SELECT client_id FROM machines WHERE id = ?').get(machineId);
    if (!machine || !machine.client_id) {
      return res.status(404).json({ error: 'Máquina no encontrada' });
    }

    const sessionData = await verifyOtpAndCreateSession(
      machine.client_id, 
      email, 
      code, 
      req.headers['user-agent'] || ''
    );

    // Setea cookie httpOnly de larga duración (180 días)
    const isProd = process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT;
    res.cookie('emp_session', sessionData.token, {
      maxAge: 180 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: Boolean(isProd),
      sameSite: 'lax',
      path: '/',
    });

    res.json({
      ok: true,
      token: sessionData.token,
      employee: sessionData.employee,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── 4. Validar sesión activa (me) ─────────────────────────────────────────────
router.get('/auth/me', async (req, res) => {
  try {
    const token = getReqToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Sin sesión activa' });
    }

    const machineId = req.query.machineId;
    let expectedClientId = null;
    if (machineId) {
      const m = await db.prepare('SELECT client_id FROM machines WHERE id = ?').get(machineId);
      expectedClientId = m?.client_id || null;
    }

    const employee = await getEmployeeBySessionToken(token, expectedClientId);
    if (!employee) {
      return res.status(401).json({ error: 'Sesión no válida o expirada' });
    }

    // Si se consulta para una máquina específica, buscar si hubo un pago exitoso en los últimos 60 minutos
    let lastRecentPaidIntent = null;
    if (machineId) {
      const recent = await db.prepare(`
        SELECT id, list_amount, charge_amount, discount_pct, discount_amount, paid_at
        FROM employee_payment_intents
        WHERE employee_id = ? AND machine_id = ? AND status = 'paid'
          AND paid_at >= NOW() - INTERVAL '60 minutes'
        ORDER BY paid_at DESC LIMIT 1
      `).get(employee.employeeId, machineId);
      if (recent) {
        lastRecentPaidIntent = {
          id: recent.id,
          listAmount: Number(recent.list_amount),
          chargeAmount: Number(recent.charge_amount),
          discountPct: Number(recent.discount_pct),
          discountAmount: Number(recent.discount_amount),
          paidAt: recent.paid_at,
        };
      }
    }

    res.json({ ok: true, employee, lastRecentPaidIntent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 5. Cerrar sesión ──────────────────────────────────────────────────────────
router.post('/auth/logout', async (req, res) => {
  try {
    const token = getReqToken(req);
    if (token) {
      await revokeEmployeeSession(token);
    }
    res.clearCookie('emp_session', { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 6. Crear orden de pago con descuento en Mercado Pago ─────────────────────
router.post('/checkout/create-order', requireEmployeeAuth, async (req, res) => {
  try {
    const { machineId, listAmount: inputAmount } = req.body || {};
    if (!machineId) {
      return res.status(400).json({ error: 'machineId es requerido' });
    }

    const machine = await db.prepare(`
      SELECT m.*, c.name as client_name, c.default_discount_pct, c.employee_discounts_enabled
      FROM machines m
      JOIN clients c ON c.id = m.client_id
      WHERE m.id = ?
    `).get(machineId);

    if (!machine) {
      return res.status(404).json({ error: 'Máquina no encontrada' });
    }

    if (machine.client_id !== req.employee.clientId) {
      return res.status(403).json({ error: 'Tu beneficio de empleado no aplica a las máquinas de esta empresa' });
    }

    if (!machine.employee_discount_enabled || !machine.employee_discounts_enabled) {
      return res.status(403).json({ error: 'El beneficio de empleados no está activo en esta máquina' });
    }

    if (machine.status !== 'active') {
      return res.status(400).json({ error: 'La máquina se encuentra fuera de servicio en este momento' });
    }

    // Determinar monto de lista
    let listAmount;
    if (machine.qr_mode === 'fixed') {
      listAmount = Number(machine.qr_fixed_amount);
      if (!listAmount || listAmount <= 0) {
        return res.status(400).json({ error: 'La máquina de precio fijo no tiene monto configurado' });
      }
    } else {
      listAmount = Math.floor(Number(inputAmount) || 0);
      const minPayment = Number(machine.min_payment) || 200;
      if (listAmount < minPayment) {
        return res.status(400).json({ error: `El monto mínimo aceptado es $${minPayment}` });
      }
    }

    // Calcular descuento
    const discountPct = Number(req.employee.discountPct) || 20;
    const chargeAmount = Math.max(15, Math.round(listAmount * (1 - discountPct / 100)));
    const discountAmount = listAmount - chargeAmount;

    // Generar identificador de orden propio: tv_emp_<random>
    const intentId = 'tv_emp_' + crypto.randomBytes(8).toString('hex');

    // Resolver URL base para retornos de MP
    const origin = req.headers.origin || req.headers.referer;
    let appBaseUrl = 'https://www.vendpoint.com.ar';
    if (origin) {
      try {
        const u = new URL(origin);
        appBaseUrl = u.origin;
      } catch (_) {}
    }

    // Crear la preferencia en Mercado Pago
    const preference = await createPreference({
      items: [{
        title: `${machine.name} · Beneficio Empleado (${discountPct}% off)`,
        quantity: 1,
        unit_price: chargeAmount,
        currency_id: 'ARS',
      }],
      externalReference: intentId,
      statementDescriptor: 'VendPoint',
      backUrls: {
        success: `${appBaseUrl}/e/${machine.id}?status=success&intent=${intentId}`,
        failure: `${appBaseUrl}/e/${machine.id}?status=failure&intent=${intentId}`,
        pending: `${appBaseUrl}/e/${machine.id}?status=pending&intent=${intentId}`,
      },
      autoReturn: 'approved',
      payerEmail: req.employee.email,
    }, machine.client_id);

    // Guardar el intent en la base de datos
    await db.prepare(`
      INSERT INTO employee_payment_intents (
        id, machine_id, client_id, employee_id, list_amount, discount_pct,
        discount_amount, charge_amount, mp_preference_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      intentId,
      machine.id,
      machine.client_id,
      req.employee.employeeId,
      listAmount,
      discountPct,
      discountAmount,
      chargeAmount,
      preference?.id || null
    );

    res.json({
      ok: true,
      intentId,
      listAmount,
      discountPct,
      discountAmount,
      chargeAmount,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
    });
  } catch (err) {
    console.error('[employee-checkout-order-err]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 7. Consultar estado del intent de pago (Polling post-pago) ────────────────
router.get('/checkout/intent-status/:intentId', async (req, res) => {
  try {
    const { intentId } = req.params;
    let row = await db.prepare(`
      SELECT id, machine_id, status, list_amount, charge_amount, discount_pct, discount_amount, paid_at
      FROM employee_payment_intents
      WHERE id = ?
    `).get(intentId);

    if (!row) {
      return res.status(404).json({ error: 'Intent no encontrado' });
    }

    // Si aún está pendiente, reconciliar activamente contra Mercado Pago
    // (cubre entornos de desarrollo sin webhooks públicos y demoras de red de MP)
    if (row.status === 'pending') {
      const fulfillment = await fulfillEmployeePaymentIntent(intentId);
      if (fulfillment.paid) {
        row = await db.prepare(`
          SELECT id, machine_id, status, list_amount, charge_amount, discount_pct, discount_amount, paid_at
          FROM employee_payment_intents
          WHERE id = ?
        `).get(intentId);
      }
    }

    res.json({
      ok: true,
      status: row.status,
      paidAt: row.paid_at,
      listAmount: Number(row.list_amount),
      chargeAmount: Number(row.charge_amount),
      discountPct: Number(row.discount_pct),
      discountAmount: Number(row.discount_amount),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

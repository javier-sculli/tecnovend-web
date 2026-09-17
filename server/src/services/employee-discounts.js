import crypto from 'crypto';
import db from '../db/schema.js';
import { getPayment, refundPaymentMP } from './mp.js';

// Caché en memoria para status del módulo por cliente (evita consultar la BD en cada pago)
const _configCache = new Map();

export function invalidateClientDiscountConfigCache(clientId) {
  if (clientId) _configCache.delete(clientId);
  else _configCache.clear();
}

export async function getClientDiscountConfig(clientId) {
  if (!clientId) return { enabled: false, defaultDiscountPct: 20 };
  if (_configCache.has(clientId)) {
    return _configCache.get(clientId);
  }

  const row = await db.prepare(`
    SELECT employee_discounts_enabled, default_discount_pct 
    FROM clients WHERE id = ?
  `).get(clientId);

  const config = {
    enabled: Boolean(row?.employee_discounts_enabled),
    defaultDiscountPct: Number(row?.default_discount_pct) || 20,
  };

  _configCache.set(clientId, config);
  return config;
}

function genLogId() {
  return 'edl_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Busca un empleado activo de la organización por email de MP o por DNI.
 */
export async function matchEmployee(clientId, payerEmail, payerDni) {
  if (!clientId) return null;

  const normalizedEmail = payerEmail ? String(payerEmail).trim().toLowerCase() : null;
  const cleanDni = payerDni ? String(payerDni).replace(/\D/g, '') : null;

  if (normalizedEmail) {
    const empByEmail = await db.prepare(`
      SELECT * FROM client_employees 
      WHERE client_id = ? AND LOWER(email) = ? AND status = 'active'
    `).get(clientId, normalizedEmail);

    if (empByEmail) return empByEmail;
  }

  if (cleanDni) {
    const empByDni = await db.prepare(`
      SELECT * FROM client_employees 
      WHERE client_id = ? AND (dni = ? OR REPLACE(REPLACE(dni, '.', ''), '-', '') = ?) AND status = 'active'
    `).get(clientId, payerDni, cleanDni);

    if (empByDni) return empByDni;
  }

  return null;
}

/**
 * Evalúa y procesa el descuento corporativo para un pago aprobado.
 */
export async function processEmployeeDiscount({ paymentId, mpPaymentId, amount, ownerClientId, mpPaymentObj }) {
  if (!ownerClientId || !mpPaymentId || !amount || amount <= 0) return null;

  try {
    // 1. Verificar si el cliente tiene el módulo habilitado (vía caché en memoria 0 ms)
    const client = await getClientDiscountConfig(ownerClientId);

    if (!client || !client.enabled) {
      return null;
    }

    // 2. Obtener datos del payer si no vienen en la llamada
    let paymentData = mpPaymentObj;
    if (!paymentData || !paymentData.payer) {
      try {
        paymentData = await getPayment(mpPaymentId, ownerClientId);
      } catch (e) {
        console.warn(`[employee-discount] no se pudo consultar el pago ${mpPaymentId} en MP: ${e.message}`);
        return null;
      }
    }

    const payerEmail = paymentData?.payer?.email || null;
    const payerDni = paymentData?.payer?.identification?.number || null;

    if (!payerEmail && !payerDni) {
      console.log(`[employee-discount] pago ${mpPaymentId} sin datos de payer (email/DNI) en MP`);
      return null;
    }

    // 3. Matchear empleado
    const employee = await matchEmployee(ownerClientId, payerEmail, payerDni);
    if (!employee) {
      return null;
    }

    // 4. Calcular el monto del descuento
    const discountPct = Number(employee.discount_pct) > 0 ? Number(employee.discount_pct) : (Number(client.default_discount_pct) || 20);
    const refundAmount = Math.round(amount * (discountPct / 100));

    if (refundAmount <= 0 || refundAmount >= amount) {
      console.warn(`[employee-discount] monto de descuento inválido: $${refundAmount} sobre pago $${amount} (${discountPct}%)`);
      return null;
    }

    console.log(`[employee-discount] Matcheado empleado ${employee.name || employee.id} (DNI ${employee.dni || 'S/D'}, Mail ${employee.email || 'S/M'}). Descuento: ${discountPct}% -> Reembolso $${refundAmount} sobre $${amount}`);

    const logId = genLogId();
    await db.prepare(`
      INSERT INTO employee_discount_logs (
        id, payment_id, client_id, employee_id, payer_email, payer_dni, 
        original_amount, discount_pct, refund_amount, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `).run(
      logId, paymentId, ownerClientId, employee.id, payerEmail, payerDni,
      amount, discountPct, refundAmount
    );

    // 5. Ejecutar el reembolso parcial en Mercado Pago
    try {
      const refundRes = await refundPaymentMP(mpPaymentId, ownerClientId, {
        amount: refundAmount,
        idempotencyKey: `emp-disc-${paymentId}`
      });

      const mpRefundId = refundRes?.id ? String(refundRes.id) : null;
      await db.prepare(`
        UPDATE employee_discount_logs 
        SET status = 'done', mp_refund_id = ? 
        WHERE id = ?
      `).run(mpRefundId, logId);

      console.log(`[employee-discount] ✓ Reembolso parcial de $${refundAmount} exitoso en MP para pago ${mpPaymentId} (Ref: ${mpRefundId})`);
      return { id: logId, refundAmount, discountPct, employee };
    } catch (refundErr) {
      console.error(`[employee-discount] ❌ Falló reembolso parcial en MP para pago ${mpPaymentId}: ${refundErr.message}`);
      await db.prepare(`
        UPDATE employee_discount_logs 
        SET status = 'failed', error_message = ? 
        WHERE id = ?
      `).run(refundErr.message, logId);
      return null;
    }
  } catch (err) {
    console.error(`[employee-discount] Excepción procesando descuento: ${err.message}`);
    return null;
  }
}

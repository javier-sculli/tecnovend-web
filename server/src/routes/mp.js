import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import * as mp from '../services/mp.js';
import { refundPaymentById } from '../services/refunds.js';
import { requireAuth, getEffectiveOrgContext } from '../middleware/auth.js';

const router = Router();


// ─── OAuth ───────────────────────────────────────────────────────────────────

// El cliente/organización dueño de la conexión MP: lo manda el front en ?clientId=, ?org= o x-org-id.
const orgOf = (req) => req.query.clientId || req.query.org || req.headers['x-org-id'] || null;

// GET /api/mp/auth?org=<clientId> — inicia el OAuth para conectar la cuenta MP
// de ESE cliente. El local y las cajas van a vivir en su cuenta.
router.get('/auth', async (req, res) => {
  const mpAppClientId = process.env.MP_CLIENT_ID;
  if (!mpAppClientId) return res.status(500).json({ error: 'MP_CLIENT_ID no configurado' });

  const org = orgOf(req);
  if (!org) return res.status(400).send('Faltó el cliente (org) que conecta Mercado Pago.');

  const redirectUri = process.env.MP_REDIRECT_URI || (process.env.NODE_ENV === 'production' ? 'https://www.vendpoint.com.ar/api/mp/auth/callback' : `${req.protocol}://${req.get('host')}/api/mp/auth/callback`);
  const state = crypto.randomBytes(16).toString('hex');
  // Guardar state + el cliente que conecta, para recuperarlos en el callback.
  const stateKey = `oauth_state_${state}`;
  const upsert = db.prepare(`INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  await upsert.run(stateKey, org);

  console.log(`[oauth] Iniciando conexión MP para el cliente ${org}`);

  const url = new URL('https://auth.mercadopago.com.ar/authorization');
  url.searchParams.set('client_id', mpAppClientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);

  res.redirect(url.toString());
});

// GET /api/mp/auth/callback — MP redirige acá con el code
router.get('/auth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error(`[oauth] Error recibido desde Mercado Pago: ${error} — ${error_description || ''}`);
    return res.redirect(`/pagos?mp_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code || !state) {
    return res.redirect(`/pagos?mp_error=${encodeURIComponent('Faltó el código de autorización o estado de Mercado Pago.')}`);
  }

  // Verificar state y recuperar el cliente que inició la conexión.
  const stateKey = `oauth_state_${state}`;
  const orgRow = await db.prepare('SELECT value FROM config WHERE key = ?').get(stateKey);
  const org = orgRow?.value || null;

  // Limpiar el state de un solo uso en cualquier caso
  await db.prepare('DELETE FROM config WHERE key = ?').run(stateKey).catch(() => {});

  if (!org) {
    console.error(`[oauth] State inválido o expirado (${state})`);
    return res.redirect(`/pagos?mp_error=${encodeURIComponent('La sesión de autorización expiró o es inválida. Intentá de nuevo.')}`);
  }

  const mpAppClientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = process.env.MP_REDIRECT_URI || (process.env.NODE_ENV === 'production' ? 'https://www.vendpoint.com.ar/api/mp/auth/callback' : `${req.protocol}://${req.get('host')}/api/mp/auth/callback`);

  try {
    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: mpAppClientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      const errMsg = data.message || data.error_description || JSON.stringify(data);
      console.error(`[oauth] Error en token MP (status ${tokenRes.status}):`, errMsg);
      throw new Error(errMsg);
    }

    await mp.setStoredToken(org, {
      token: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      mpUserId: data.user_id,
    });
    console.log(`[oauth] ✓ Cuenta MP user_id ${data.user_id} conectada con éxito al cliente ${org}`);

    res.redirect('/pagos?mp_connected=1');
  } catch (e) {
    console.error('[oauth] Error final obteniendo token:', e.message);
    res.redirect(`/pagos?mp_error=${encodeURIComponent('Error al obtener el token de Mercado Pago: ' + e.message)}`);
  }
});

// POST /api/mp/auth/disconnect — desvincula la cuenta MP del cliente activo

router.post('/auth/disconnect', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const org = ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);
  if (!org) return res.status(400).json({ error: 'Faltó el cliente (org)' });
  await db.prepare('DELETE FROM mp_connections WHERE client_id = ?').run(org);
  res.json({ ok: true });
});

// ─── Status ──────────────────────────────────────────────────────────────────

// GET /api/mp/status — conexión MP del cliente activo (x-org-id)
router.get('/status', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const org = ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);
  if (!org || !(await mp.hasConnection(org))) return res.json({ connected: false });
  try {
    const userId = await mp.getUserId(org);
    res.json({ connected: true, user_id: userId, oauth: true });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// GET /api/mp/stores — locales de la cuenta MP del cliente activo
router.get('/stores', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const org = ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);
  if (!org) return res.json([]);
  try {
    const stores = await mp.getStores(org);
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/stores/:id — detalle de un local por ID
router.get('/stores/:id', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const org = ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);
  try {
    const store = await mp.getStore(req.params.id, org);
    res.json(store);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/mp/pos?storeId=X — cajas de un local (o todas si no se pasa storeId)
router.get('/pos', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const org = ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);
  const { storeId } = req.query;
  try {
    const pos = await mp.listPOS(storeId, org);
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mp/pos/:machineId — crear (o reutilizar) la caja de la máquina
router.post('/pos/:machineId', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  if (!ctx.isSuperAdmin) {
    if (!machine.client_id || !ctx.allowedClientIds.includes(machine.client_id)) {
      return res.status(403).json({ error: 'No tenés acceso a esta máquina' });
    }
  }

  try {
    const r = await mp.provisionMachinePos(machine);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[mp/setup]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/pos/:machineId — obtener datos del POS + QR
router.get('/pos/:machineId', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  if (!ctx.isSuperAdmin) {
    if (!machine.client_id || !ctx.allowedClientIds.includes(machine.client_id)) {
      return res.status(403).json({ error: 'No tenés acceso a esta máquina' });
    }
  }

  if (!machine.mp_pos_id) return res.status(404).json({ error: 'Sin POS configurado', code: 'no_pos' });

  try {
    const pos = await mp.getPOS(machine.mp_pos_id, machine.client_id);
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/payments — pagos recientes de la BD local
router.get('/payments', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const { machineId, since, limit = 20 } = req.query;

  let query = `
    SELECT p.*,
           edl.id as emp_discount_id,
           edl.discount_pct as emp_discount_pct,
           edl.refund_amount as emp_refund_amount,
           edl.status as emp_discount_status,
           e.name as emp_name,
           e.email as emp_email
    FROM payments p 
    JOIN machines m ON m.id = p.machine_id 
    LEFT JOIN employee_discount_logs edl ON edl.payment_id = p.id AND edl.status = 'done'
    LEFT JOIN client_employees e ON e.id = edl.employee_id
    WHERE 1=1
  `;
  const args = [];

  if (!ctx.isSuperAdmin) {
    if (!ctx.allowedClientIds || ctx.allowedClientIds.length === 0) {
      return res.json([]);
    }
    const placeholders = ctx.allowedClientIds.map(() => '?').join(',');
    query += ` AND m.client_id IN (${placeholders})`;
    args.push(...ctx.allowedClientIds);
  } else if (ctx.activeOrgId) {
    query += ' AND m.client_id = ?';
    args.push(ctx.activeOrgId);
  }

  if (machineId) { query += ' AND p.machine_id = ?'; args.push(machineId); }
  if (since) { query += ' AND p.created_at > ?'; args.push(since); }
  query += ' ORDER BY p.created_at DESC LIMIT ?';
  args.push(+limit);

  res.json(await db.prepare(query).all(...args));
});

// POST /api/mp/payments/:id/refund — reembolso manual de un pago (botón Devolver)
router.post('/payments/:id/refund', requireAuth, async (req, res) => {
  let ctx;
  try { ctx = await getEffectiveOrgContext(req); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

  const payment = await db.prepare('SELECT p.*, m.client_id FROM payments p JOIN machines m ON m.id = p.machine_id WHERE p.id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });

  if (!ctx.isSuperAdmin) {
    if (!payment.client_id || !ctx.allowedClientIds.includes(payment.client_id)) {
      return res.status(403).json({ error: 'No tenés permisos para reembolsar este pago' });
    }
  }

  const r = await refundPaymentById(req.params.id);
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  res.json({ ok: true, already: r.already || false });
});

export default router;


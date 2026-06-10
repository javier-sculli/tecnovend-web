import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import * as mp from '../services/mp.js';
import { refundPaymentById } from '../services/refunds.js';

const router = Router();

// ─── OAuth ───────────────────────────────────────────────────────────────────

// GET /api/mp/auth — inicia el flujo OAuth, redirige al portal de MP
router.get('/auth', (req, res) => {
  const clientId = process.env.MP_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'MP_CLIENT_ID no configurado' });

  const redirectUri = `${req.protocol}://${req.get('host')}/api/mp/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  // Guardar state para verificar en el callback
  db.prepare(`INSERT INTO config (key, value) VALUES ('oauth_state', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .run(state);

  const url = new URL('https://auth.mercadopago.com/authorization');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);

  res.redirect(url.toString());
});

// GET /api/mp/auth/callback — MP redirige acá con el code
router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Faltó el código de autorización de MP.');

  // Verificar state
  const savedState = db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_state');
  if (!savedState || savedState.value !== state) {
    return res.status(400).send('State inválido — posible ataque CSRF.');
  }

  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/mp/auth/callback`;

  try {
    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.message || JSON.stringify(data));

    mp.setStoredToken(data.access_token, data.refresh_token, data.expires_in);
    console.log(`[oauth] ✓ token guardado para user_id ${data.user_id}`);

    // Redirigir a la web con éxito
    res.redirect('/?mp_connected=1');
  } catch (e) {
    console.error('[oauth]', e.message);
    res.status(500).send(`Error al obtener token: ${e.message}`);
  }
});

// GET /api/mp/auth/disconnect — desvincula la cuenta MP
router.post('/auth/disconnect', (req, res) => {
  for (const key of ['mp_access_token', 'mp_refresh_token', 'mp_token_expires_at']) {
    db.prepare('DELETE FROM config WHERE key = ?').run(key);
  }
  res.json({ ok: true });
});

// ─── Status ──────────────────────────────────────────────────────────────────

// GET /api/mp/status — verificar conexión con MP
router.get('/status', async (req, res) => {
  try {
    const userId = await mp.getUserId();
    const isOAuth = !!db.prepare('SELECT value FROM config WHERE key = ?').get('mp_access_token');
    res.json({ connected: true, user_id: userId, oauth: isOAuth });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// GET /api/mp/stores — locales de MP
router.get('/stores', async (req, res) => {
  try {
    const stores = await mp.getStores();
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/stores/:id — detalle de un local por ID
router.get('/stores/:id', async (req, res) => {
  try {
    const store = await mp.getStore(req.params.id);
    res.json(store);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/mp/pos?storeId=X — cajas de un local (o todas si no se pasa storeId)
router.get('/pos', async (req, res) => {
  const { storeId } = req.query;
  try {
    const pos = await mp.listPOS(storeId);
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mp/pos/:machineId — crear store + POS en MP para una máquina
router.post('/pos/:machineId', async (req, res) => {
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  try {
    const storeExtId = `tv_${machine.id}`;

    const storeData = await mp.createStore({
      externalId: storeExtId,
      name: machine.name,
      address: machine.location || '',
    });

    const posData = await mp.createPOS({
      externalId: machine.id,
      name: machine.name,
      externalStoreId: storeExtId,
    });

    db.prepare('UPDATE machines SET pos_id = ?, mp_pos_id = ?, mp_store_id = ? WHERE id = ?')
      .run(machine.id, String(posData.id), String(storeData.id), machine.id);

    res.json({
      ok: true,
      pos_id: posData.id,
      store_id: storeData.id,
      qr_code: posData.qr_code,
      qr_code_base64: posData.qr_code_base64,
    });
  } catch (e) {
    console.error('[mp/setup]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/pos/:machineId — obtener datos del POS + QR
router.get('/pos/:machineId', async (req, res) => {
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });
  if (!machine.mp_pos_id) return res.status(404).json({ error: 'Sin POS configurado', code: 'no_pos' });

  try {
    const pos = await mp.getPOS(machine.mp_pos_id);
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/mp/pos/:machineId/order — cargar una orden al QR estático
router.put('/pos/:machineId/order', async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount < 15) return res.status(400).json({ error: 'amount requerido y debe ser >= $15 (mínimo de Mercado Pago)' });

  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });
  if (!machine.pos_id) return res.status(404).json({ error: 'Sin POS configurado', code: 'no_pos' });
  if (machine.status !== 'active') return res.status(409).json({ error: 'Máquina fuera de servicio — no se puede generar QR', code: 'out_of_service' });

  const externalRef = `tv_${machine.id}_${Date.now()}`;
  try {
    const order = await mp.createOrder(machine.pos_id, {
      amount,
      description: description || machine.name,
      externalReference: externalRef,
    });
    res.json({ ok: true, external_reference: externalRef, order_id: order?.id || null });
  } catch (e) {
    console.error('[mp/order]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/orders/:orderId — estado de una orden en MP
router.get('/orders/:orderId', async (req, res) => {
  try {
    const order = await mp.getOrder(req.params.orderId);
    res.json({ id: order.id, status: order.status, total_amount: order.total_amount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/mp/pos/:machineId/order — limpiar orden del QR
router.delete('/pos/:machineId/order', async (req, res) => {
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine || !machine.pos_id) return res.status(404).json({ error: 'Sin POS' });

  try {
    await mp.deleteOrder(machine.pos_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/payments — pagos recientes de la BD local
router.get('/payments', (req, res) => {
  const { machineId, since, limit = 20 } = req.query;
  let query = 'SELECT * FROM payments WHERE 1=1';
  const args = [];
  if (machineId) { query += ' AND machine_id = ?'; args.push(machineId); }
  if (since) { query += ' AND created_at > ?'; args.push(since); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  args.push(+limit);
  res.json(db.prepare(query).all(...args));
});

// POST /api/mp/payments/:id/refund — reembolso manual de un pago (botón Devolver)
router.post('/payments/:id/refund', async (req, res) => {
  const r = await refundPaymentById(req.params.id);
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  res.json({ ok: true, already: r.already || false });
});

export default router;

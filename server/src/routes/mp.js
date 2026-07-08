import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import * as mp from '../services/mp.js';
import { refundPaymentById } from '../services/refunds.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ─── OAuth ───────────────────────────────────────────────────────────────────

// El cliente/organización dueño de la conexión MP: lo manda el front en x-org-id
// (o ?org= en el arranque del OAuth, que es una navegación de página completa).
const orgOf = (req) => req.query.org || req.headers['x-org-id'] || null;

// GET /api/mp/auth?org=<clientId> — inicia el OAuth para conectar la cuenta MP
// de ESE cliente. El local y las cajas van a vivir en su cuenta.
router.get('/auth', async (req, res) => {
  const mpAppClientId = process.env.MP_CLIENT_ID;
  if (!mpAppClientId) return res.status(500).json({ error: 'MP_CLIENT_ID no configurado' });

  const org = orgOf(req);
  if (!org) return res.status(400).send('Faltó el cliente (org) que conecta Mercado Pago.');

  const redirectUri = `${req.protocol}://${req.get('host')}/api/mp/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  // Guardar state + el cliente que conecta, para recuperarlos en el callback.
  const upsert = db.prepare(`INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  await upsert.run('oauth_state', state);
  await upsert.run('oauth_state_org', org);

  const url = new URL('https://auth.mercadopago.com/authorization');
  url.searchParams.set('client_id', mpAppClientId);
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

  // Verificar state y recuperar el cliente que inició la conexión.
  const savedState = await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_state');
  if (!savedState || savedState.value !== state) {
    return res.status(400).send('State inválido — posible ataque CSRF.');
  }
  const orgRow = await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_state_org');
  const org = orgRow?.value || null;
  if (!org) return res.status(400).send('No se pudo determinar el cliente de la conexión.');

  const mpAppClientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/mp/auth/callback`;

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
    if (!tokenRes.ok) throw new Error(data.message || JSON.stringify(data));

    await mp.setStoredToken(org, {
      token: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      mpUserId: data.user_id,
    });
    console.log(`[oauth] ✓ cuenta MP user_id ${data.user_id} conectada al cliente ${org}`);

    // Limpiar el state de un solo uso + el token global legacy: ya no hay
    // fallback, cada cliente usa exclusivamente su propia cuenta conectada.
    await db.prepare(`DELETE FROM config WHERE key IN
      ('oauth_state', 'oauth_state_org', 'mp_access_token', 'mp_refresh_token', 'mp_token_expires_at')`).run();

    res.redirect('/?mp_connected=1');
  } catch (e) {
    console.error('[oauth]', e.message);
    res.status(500).send(`Error al obtener token: ${e.message}`);
  }
});

// POST /api/mp/auth/disconnect — desvincula la cuenta MP del cliente activo
router.post('/auth/disconnect', async (req, res) => {
  const org = orgOf(req);
  if (!org) return res.status(400).json({ error: 'Faltó el cliente (org)' });
  await db.prepare('DELETE FROM mp_connections WHERE client_id = ?').run(org);
  res.json({ ok: true });
});

// ─── Status ──────────────────────────────────────────────────────────────────

// GET /api/mp/status — conexión MP del cliente activo (x-org-id). `connected`
// refleja si ESE cliente tiene su propia cuenta conectada (no el token global).
router.get('/status', async (req, res) => {
  const org = orgOf(req);
  if (!org || !(await mp.hasConnection(org))) return res.json({ connected: false });
  try {
    const userId = await mp.getUserId(org);
    res.json({ connected: true, user_id: userId, oauth: true });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// GET /api/mp/stores — locales de la cuenta MP del cliente activo
router.get('/stores', async (req, res) => {
  try {
    const stores = await mp.getStores(orgOf(req));
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/stores/:id — detalle de un local por ID
router.get('/stores/:id', async (req, res) => {
  try {
    const store = await mp.getStore(req.params.id, orgOf(req));
    res.json(store);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// GET /api/mp/pos?storeId=X — cajas de un local (o todas si no se pasa storeId)
router.get('/pos', async (req, res) => {
  const { storeId } = req.query;
  try {
    const pos = await mp.listPOS(storeId, orgOf(req));
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mp/pos/:machineId — crear (o reutilizar) la caja de la máquina en el
// local default y asociarla. Misma lógica que usa el alta de máquina.
router.post('/pos/:machineId', async (req, res) => {
  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  try {
    const r = await mp.provisionMachinePos(machine);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[mp/setup]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mp/pos/:machineId — obtener datos del POS + QR
router.get('/pos/:machineId', async (req, res) => {
  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.machineId);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });
  if (!machine.mp_pos_id) return res.status(404).json({ error: 'Sin POS configurado', code: 'no_pos' });

  try {
    const pos = await mp.getPOS(machine.mp_pos_id, machine.client_id);
    res.json(pos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/mp/payments — pagos recientes de la BD local
router.get('/payments', async (req, res) => {
  const { machineId, since, limit = 20 } = req.query;
  let query = 'SELECT * FROM payments WHERE 1=1';
  const args = [];
  if (machineId) { query += ' AND machine_id = ?'; args.push(machineId); }
  if (since) { query += ' AND created_at > ?'; args.push(since); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  args.push(+limit);
  res.json(await db.prepare(query).all(...args));
});

// POST /api/mp/payments/:id/refund — reembolso manual de un pago (botón Devolver)
router.post('/payments/:id/refund', async (req, res) => {
  const r = await refundPaymentById(req.params.id);
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  res.json({ ok: true, already: r.already || false });
});

export default router;

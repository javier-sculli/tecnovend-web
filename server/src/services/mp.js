import crypto from 'crypto';
import db from '../db/schema.js';

const BASE = 'https://api.mercadopago.com';
let _userId = null;

export function getStoredToken() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('mp_access_token');
  return row?.value || process.env.MP_ACCESS_TOKEN || null;
}

export function setStoredToken(token, refreshToken, expiresIn) {
  const upsert = db.prepare(`
    INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  upsert.run('mp_access_token', token);
  if (refreshToken) upsert.run('mp_refresh_token', refreshToken);
  if (expiresIn) upsert.run('mp_token_expires_at', String(Date.now() + expiresIn * 1000));
  _userId = null; // invalidar caché de userId
}

function hdrs(idempotencyKey) {
  const token = getStoredToken();
  if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    // Para operaciones que mueven plata (reembolsos) usamos una key determinística
    // por id, así un reintento o una carrera no procesa dos veces en MP.
    'X-Idempotency-Key': idempotencyKey || crypto.randomUUID(),
  };
}

async function call(method, path, body, { idempotencyKey } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: hdrs(idempotencyKey),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.message || json?.cause?.[0]?.description || JSON.stringify(json);
    throw new Error(`MP ${method} ${path}: ${res.status} — ${msg}`);
  }
  return json;
}

export async function getUserId() {
  if (_userId) return _userId;
  const me = await call('GET', '/users/me');
  _userId = me.id;
  return _userId;
}

export async function getStores() {
  const userId = await getUserId();
  try {
    const data = await call('GET', `/users/${userId}/stores?offset=0&limit=50`);
    return data?.stores || data?.results || [];
  } catch {
    return [];
  }
}

export async function getStore(storeId) {
  const userId = await getUserId();
  return call('GET', `/users/${userId}/stores/${storeId}`);
}

export async function createStore({ externalId, name, address }) {
  const userId = await getUserId();
  // MP requiere city_name de lista predefinida, state_name, lat y lon obligatorios.
  // Usamos defaults de CABA/GBA cuando no hay coordenadas exactas.
  const [streetName, streetNumber] = splitAddress(address || name);
  return call('POST', `/users/${userId}/stores`, {
    name,
    external_id: externalId,
    location: {
      street_name: streetName,
      street_number: streetNumber,
      city_name: 'Avellaneda',
      state_name: 'Buenos Aires',
      latitude: -34.6637,
      longitude: -58.3657,
    },
  });
}

function splitAddress(addr) {
  const match = addr.match(/^(.*?)\s+(\d+[\w-]*)$/);
  return match ? [match[1], match[2]] : [addr, '0'];
}

export async function createPOS({ externalId, name, externalStoreId }) {
  return call('POST', '/pos', {
    name,
    fixed_amount: false,
    external_store_id: externalStoreId,
    external_id: externalId,
    category: 621102,
  });
}

export async function getPOS(posId) {
  return call('GET', `/pos/${posId}`);
}

export async function createOrder(externalPosId, { amount, description, externalReference }) {
  const amtStr = String(Number(amount));
  const title = description || 'Compra';
  return call('POST', '/v1/orders', {
    type: 'qr',
    external_reference: externalReference,
    total_amount: amtStr,
    items: [{
      title,
      unit_price: amtStr,
      quantity: 1,
      unit_measure: 'unit',
    }],
    config: { qr: { external_pos_id: externalPosId } },
    transactions: {
      payments: [{ amount: amtStr }],
    },
  });
}

export async function deleteOrder(externalPosId) {
  // La nueva API de orders no tiene DELETE por pos_id; se cancela por order_id.
  // Por ahora no hacemos nada — las orders expiran solas.
  console.log(`[mp] deleteOrder: pos ${externalPosId} — no-op con nueva API`);
}

export async function getOrder(orderId) {
  return call('GET', `/v1/orders/${orderId}`);
}

export async function getPayment(paymentId) {
  return call('GET', `/v1/payments/${paymentId}`);
}

// Reembolso total de una orden (API nueva /v1/orders). Body vacío = total.
export async function refundOrder(orderId) {
  return call('POST', `/v1/orders/${orderId}/refund`, undefined, { idempotencyKey: `refund-order-${orderId}` });
}

// Reembolso total de un payment (API legacy /v1/payments). Body vacío = total.
export async function refundPaymentMP(paymentId) {
  return call('POST', `/v1/payments/${paymentId}/refunds`, {}, { idempotencyKey: `refund-pay-${paymentId}` });
}

export async function listPOS(storeId) {
  const query = storeId ? `?store_id=${storeId}&offset=0&limit=50` : '?offset=0&limit=50';
  const data = await call('GET', `/pos${query}`);
  return data?.results || (Array.isArray(data) ? data : []);
}

// Verifica firma HMAC de MP según el formato: ts=X,v1=HASH
// Mensaje firmado: id:{dataId};request-id:{xReqId};ts:{ts};
export function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // en dev sin secret, permitir todo

  const xSig = req.headers['x-signature'];
  const xReqId = req.headers['x-request-id'];
  if (!xSig || !xReqId) return false;

  const dataId = req.query?.data?.id ?? req.query?.['data.id'] ?? req.body?.data?.id;

  const parts = Object.fromEntries(
    xSig.split(',').map(s => { const [k, ...v] = s.trim().split('='); return [k, v.join('=')]; })
  );
  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  const msg = `id:${dataId};request-id:${xReqId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return expected === v1;
}

import crypto from 'crypto';
import db from '../db/schema.js';

const BASE = 'https://api.mercadopago.com';

// Caché de user_id de MP por cliente (clave tokenKey()). Cada cliente tiene su
// propia cuenta de MP, así que el user_id depende del token usado.
const _userIdCache = new Map();
const tokenKey = (clientId) => clientId || '_global';

// Token de MP del cliente. SIN fallback global: cada cliente usa exclusivamente
// su propia cuenta conectada. Si no conectó, no hay token y la operación falla
// con un error claro. Nunca se comparte una cuenta de MP entre clientes.
export function getStoredToken(clientId) {
  if (!clientId) return null;
  const row = db.prepare('SELECT access_token FROM mp_connections WHERE client_id = ?').get(clientId);
  return row?.access_token || null;
}

// Guarda la conexión MP de un cliente: token + refresh + user_id de la cuenta.
// El user_id es lo que después usa el webhook para rutear cada pago al cliente.
export function setStoredToken(clientId, { token, refreshToken, expiresIn, mpUserId } = {}) {
  db.prepare(`
    INSERT INTO mp_connections (client_id, access_token, refresh_token, expires_at, mp_user_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_id) DO UPDATE SET
      access_token  = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, mp_connections.refresh_token),
      expires_at    = COALESCE(excluded.expires_at, mp_connections.expires_at),
      mp_user_id    = COALESCE(excluded.mp_user_id, mp_connections.mp_user_id),
      updated_at    = excluded.updated_at
  `).run(
    clientId,
    token,
    refreshToken ?? null,
    expiresIn ? String(Date.now() + expiresIn * 1000) : null,
    mpUserId != null ? String(mpUserId) : null,
  );
  _userIdCache.delete(tokenKey(clientId));
}

// ¿El cliente tiene una conexión MP propia? (para el gate de alta de máquinas)
export function hasConnection(clientId) {
  if (!clientId) return false;
  return !!db.prepare('SELECT 1 FROM mp_connections WHERE client_id = ?').get(clientId);
}

// Resuelve el cliente dueño de una cuenta MP por su user_id (lo usa el webhook).
export function clientByMpUser(mpUserId) {
  if (mpUserId == null) return null;
  const row = db.prepare('SELECT client_id FROM mp_connections WHERE mp_user_id = ?').get(String(mpUserId));
  return row?.client_id || null;
}

// Todos los clientes con cuenta MP conectada.
export function listConnectedClientIds() {
  return db.prepare('SELECT client_id FROM mp_connections').all().map(r => r.client_id);
}

// Trae un pago/orden probando primero el cliente resuelto por user_id y, si no
// hay o falla, el resto de las cuentas conectadas. Un pago pertenece a UNA sola
// cuenta (las demás devuelven error), así que el primero que responde es el dueño.
// Es el fallback para avisos cuyo user_id no matchea (ej: lo manda la cuenta de
// la app, no la colectora). No reintroduce token global: solo cuentas conectadas.
export async function getPaymentAny(paymentId, preferredClientId) {
  const ids = [preferredClientId, ...listConnectedClientIds().filter(c => c !== preferredClientId)].filter(Boolean);
  if (ids.length === 0) throw new Error('No hay cuentas de Mercado Pago conectadas');
  let lastErr;
  for (const cid of ids) {
    try { return { payment: await getPayment(paymentId, cid), clientId: cid }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export async function getOrderAny(orderId, preferredClientId) {
  const ids = [preferredClientId, ...listConnectedClientIds().filter(c => c !== preferredClientId)].filter(Boolean);
  if (ids.length === 0) throw new Error('No hay cuentas de Mercado Pago conectadas');
  let lastErr;
  for (const cid of ids) {
    try { return { order: await getOrder(orderId, cid), clientId: cid }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// merchant_order (legacy): contiene los pagos de una transacción. Lo usamos para
// capturar pagos que NO pasan por una orden nuestra (ej: el cliente tipea el
// monto en el QR estático). Las de otra cuenta colectora dan error → se saltan.
export async function getMerchantOrder(moId, clientId) {
  return call('GET', `/merchant_orders/${moId}`, undefined, { clientId });
}

export async function getMerchantOrderAny(moId, preferredClientId) {
  const ids = [preferredClientId, ...listConnectedClientIds().filter(c => c !== preferredClientId)].filter(Boolean);
  if (ids.length === 0) throw new Error('No hay cuentas de Mercado Pago conectadas');
  let lastErr;
  for (const cid of ids) {
    try { return { mo: await getMerchantOrder(moId, cid), clientId: cid }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function hdrs(idempotencyKey, clientId) {
  const token = getStoredToken(clientId);
  if (!token) throw new Error('El cliente no tiene una cuenta de Mercado Pago conectada');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    // Para operaciones que mueven plata (reembolsos) usamos una key determinística
    // por id, así un reintento o una carrera no procesa dos veces en MP.
    'X-Idempotency-Key': idempotencyKey || crypto.randomUUID(),
  };
}

async function call(method, path, body, { idempotencyKey, clientId } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: hdrs(idempotencyKey, clientId),
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

export async function getUserId(clientId) {
  const key = tokenKey(clientId);
  if (_userIdCache.has(key)) return _userIdCache.get(key);
  const me = await call('GET', '/users/me', undefined, { clientId });
  _userIdCache.set(key, me.id);
  return me.id;
}

export async function getStores(clientId) {
  // OJO: el endpoint es /stores/search — /stores a secas devuelve 405.
  const userId = await getUserId(clientId);
  try {
    const data = await call('GET', `/users/${userId}/stores/search?offset=0&limit=50`, undefined, { clientId });
    return data?.results || data?.stores || [];
  } catch {
    return [];
  }
}

export async function getStore(storeId, clientId) {
  const userId = await getUserId(clientId);
  return call('GET', `/users/${userId}/stores/${storeId}`, undefined, { clientId });
}

export async function createStore({ externalId, name, address }, clientId) {
  const userId = await getUserId(clientId);
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
  }, { clientId });
}

function splitAddress(addr) {
  const match = addr.match(/^(.*?)\s+(\d+[\w-]*)$/);
  return match ? [match[1], match[2]] : [addr, '0'];
}

export async function createPOS({ externalId, name, externalStoreId }, clientId) {
  // OJO: NO seteamos notification_url en la caja a propósito. Un notification_url
  // a nivel caja overridea la config global de Webhooks del panel (topic Pagos),
  // limitando los avisos. Sin él, MP usa los webhooks globales que configuramos.
  return call('POST', '/pos', {
    name,
    fixed_amount: false,
    external_store_id: externalStoreId,
    external_id: externalId,
    category: 621102,
  }, { clientId });
}

export async function getPOS(posId, clientId) {
  return call('GET', `/pos/${posId}`, undefined, { clientId });
}

// Actualiza la URL de notificación de una caja existente (las creadas antes de
// setear notification_url, o las hechas a mano, pueden no tenerla).
export async function updatePOS(posId, { notificationUrl }, clientId) {
  return call('PUT', `/pos/${posId}`, { notification_url: notificationUrl }, { clientId });
}

export async function createOrder(externalPosId, { amount, description, externalReference }, clientId) {
  const amtStr = String(Number(amount));
  const title = description || 'Compra';
  return call('POST', '/v1/orders', {
    type: 'qr',
    external_reference: externalReference,
    // Sin esto MP vence la orden a los 15 min; lo extendemos para que el
    // precio fijo del QR siga cargado en máquinas sin tráfico.
    expiration_time: 'PT24H',
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
  }, { clientId });
}

export async function deleteOrder(externalPosId) {
  // La nueva API de orders no tiene DELETE por pos_id; se cancela por order_id.
  // Por ahora no hacemos nada — las orders expiran solas.
  console.log(`[mp] deleteOrder: pos ${externalPosId} — no-op con nueva API`);
}

export async function getOrder(orderId, clientId) {
  return call('GET', `/v1/orders/${orderId}`, undefined, { clientId });
}

export async function getPayment(paymentId, clientId) {
  return call('GET', `/v1/payments/${paymentId}`, undefined, { clientId });
}

// Busca pagos de la cuenta del cliente por rango de fecha de creación. Lo usa la
// reconciliación (services/reconcile.js) para rescatar pagos que entraron a la
// cuenta pero NO generaron webhook (ej: el cliente tipea el monto en el QR
// estático). `beginDate`/`endDate` aceptan relativos de MP ('NOW-1HOURS', 'NOW').
export async function searchPayments(clientId, { beginDate = 'NOW-1HOURS', endDate = 'NOW', limit = 100 } = {}) {
  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    range: 'date_created',
    begin_date: beginDate,
    end_date: endDate,
    status: 'approved',
    limit: String(limit),
  });
  const data = await call('GET', `/v1/payments/search?${params.toString()}`, undefined, { clientId });
  return data?.results || [];
}

// Reembolso total de una orden (API nueva /v1/orders). Body vacío = total.
export async function refundOrder(orderId, clientId) {
  return call('POST', `/v1/orders/${orderId}/refund`, undefined, { idempotencyKey: `refund-order-${orderId}`, clientId });
}

// Reembolso de un payment (API legacy /v1/payments). Sin `amount` = total (MP
// devuelve el saldo reembolsable restante); con `amount` = parcial. Se pueden
// encadenar varios parciales hasta el total. `idempotencyKey` distinto por
// operación para que un parcial y un total posterior no se pisen en MP.
export async function refundPaymentMP(paymentId, clientId, { amount, idempotencyKey } = {}) {
  const body = amount != null ? { amount: Number(amount) } : {};
  return call('POST', `/v1/payments/${paymentId}/refunds`, body, { idempotencyKey: idempotencyKey || `refund-pay-${paymentId}`, clientId });
}

export async function listPOS(storeId, clientId) {
  // MP pagina /pos de a 50; la cuenta puede tener muchas más cajas (las del
  // proveedor actual conviven con las nuestras), así que juntamos todas las
  // páginas. Tope de seguridad: 1000.
  const out = [];
  const limit = 50;
  for (let offset = 0; offset < 1000; offset += limit) {
    const query = `${storeId ? `store_id=${storeId}&` : ''}offset=${offset}&limit=${limit}`;
    const data = await call('GET', `/pos?${query}`, undefined, { clientId });
    const results = data?.results || (Array.isArray(data) ? data : []);
    out.push(...results);
    const total = data?.paging?.total;
    if (results.length === 0 || (total != null && out.length >= total)) break;
  }
  return out;
}

// ─── Provisión automática: un local default compartido + una caja por máquina ──
// Toda máquina cuelga de un único local (external_id 'tv_default'); cada máquina
// tiene su propia caja (external_id = machine.id). Así nunca se comparten cajas
// entre máquinas y MP queda ordenado solo, sin elegir local/caja a mano.
const DEFAULT_STORE_EXT_ID = 'tv_default';
const DEFAULT_STORE_NAME = 'Tecnovend';

// Devuelve el local default de la cuenta del cliente, creándolo si no existe.
// El local siempre vive en la cuenta de MP del cliente (clientId).
export async function ensureDefaultStore(clientId) {
  const find = async () =>
    (await getStores(clientId)).find(s => String(s.external_id) === DEFAULT_STORE_EXT_ID) || null;

  const existing = await find();
  if (existing) return existing;

  try {
    return await createStore({
      externalId: DEFAULT_STORE_EXT_ID,
      name: DEFAULT_STORE_NAME,
      address: 'Av. Mitre 750',
    }, clientId);
  } catch (e) {
    // Carrera, o ya existía pero no vino en el listado: reintentar buscarlo.
    const retry = await find();
    if (retry) return retry;
    throw e;
  }
}

// Crea (o reutiliza) la caja QR de la máquina dentro del local default de su
// cliente y la asocia en la BD. Idempotente: si ya hay una caja con external_id
// = machine.id, la reusa en vez de crear otra. Devuelve los datos del POS + QR.
export async function provisionMachinePos(machine) {
  const clientId = machine.client_id || null;
  const store = await ensureDefaultStore(clientId);
  const storeExtId = store.external_id || DEFAULT_STORE_EXT_ID;

  // MP exige que el external_id de la caja sea alfanumérico (sin guiones bajos):
  // 'machine_230' → 'machine230'. Es el valor que MP devuelve como external_pos_id
  // en el webhook, así que es exactamente lo que guardamos en pos_id para matchear.
  const posExtId = String(machine.id).replace(/[^a-zA-Z0-9]/g, '');

  let pos = (await listPOS(store.id, clientId)).find(p => String(p.external_id) === posExtId) || null;
  if (!pos) {
    pos = await createPOS({
      externalId: posExtId,
      name: machine.name,
      externalStoreId: storeExtId,
    }, clientId);
  } else {
    // Caja ya existente: LIMPIAMOS el notification_url. Si está seteado, overridea
    // la config global de Webhooks del panel y limita los avisos. Best-effort.
    try { await updatePOS(pos.id, { notificationUrl: '' }, clientId); }
    catch (e) { console.error(`[mp] no se pudo limpiar notification_url en caja ${pos.id}: ${e.message}`); }
  }

  // pos_id = external_id (lo que MP reporta como external_pos_id en el webhook);
  // mp_pos_id = id interno de MP. El webhook matchea por cualquiera de los dos.
  db.prepare('UPDATE machines SET pos_id = ?, mp_pos_id = ?, mp_store_id = ?, mp_store_name = ? WHERE id = ?')
    .run(posExtId, String(pos.id), String(store.id), store.name || DEFAULT_STORE_NAME, machine.id);

  return {
    pos_id: posExtId,
    mp_pos_id: String(pos.id),
    store_id: String(store.id),
    store_name: store.name || DEFAULT_STORE_NAME,
    qr_code: pos.qr_code ?? pos.qr?.image ?? null,
    qr_code_base64: pos.qr_code_base64 ?? null,
  };
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

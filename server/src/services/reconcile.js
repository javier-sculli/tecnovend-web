import { searchPayments, listConnectedClientIds } from './mp.js';
import { findMachine, enqueuePayment, isOurOrderRef } from './payments.js';
import { processPendingRefunds, flagExcessForRefund } from './refunds.js';

// ─── Reconciliación de pagos ───────────────────────────────────────────────────
// MP NO manda webhook por los pagos "libres" (el cliente tipea el monto en el QR
// estático sin orden previa): el pago se acredita en la cuenta pero no avisa por
// ningún topic (ver memoria project_mp_qr_webhook). La reconciliación los rescata
// pegándole a /v1/payments/search por cuenta conectada y registrándolos igual.
//
// Reusa la MISMA lógica de pago/pulso del webhook (findMachine/enqueuePayment),
// así que un pago da exactamente el mismo resultado venga por webhook o por acá.
// Dedup por mp_payment_id UNIQUE → si ya entró por webhook, no se duplica.

// Extrae el pos_id de un objeto payment de MP (mismos campos que usa el webhook).
function posOf(payment) {
  return String(
    payment.additional_info?.pos_id ||
    payment.point_of_interaction?.point_of_interaction_detail?.id ||
    payment.pos_id ||
    ''
  );
}

// Registra un pago aprobado traído por search. Devuelve {machine, amount, pulses,
// noDispensa} si lo registró por primera vez, o null si se salta o ya existía.
async function registerPayment(payment) {
  // Saltamos los pagos de NUESTRAS órdenes: ya entran por el webhook de `order`
  // bajo el id de la ORDEN; acá el search trae el id del PAGO (distinto) y los
  // duplicaría. Solo capturamos los libres/tipeados (sin 'tv_'). Ver isOurOrderRef.
  if (isOurOrderRef(payment.external_reference)) return null;

  const posId = posOf(payment);
  const machine = await findMachine(posId);
  if (!machine) return null; // caja ajena (otro proveedor conviviendo en la cuenta)

  const amount = Math.floor(Number(payment.transaction_amount) || 0);
  // El pago SIEMPRE se registra (CLAUDE.md). El monto y el estado de la máquina
  // definen los pulsos: fuera de servicio → 0. 0 pulsos → reembolso automático.
  const outOfService = machine.status !== 'active';
  const pulses = outOfService ? 0 : Math.floor(amount / machine.pulse_value);
  // Excedente = lo que no alcanza a dispensar un pulso. Con 0 pulsos es el monto
  // entero (full refund vía refundPending); con pulsos y resto, es parcial.
  const excess = amount - pulses * machine.pulse_value;
  const noDispensa = pulses < 1;
  const queued = await enqueuePayment(machine.id, String(payment.id), amount, pulses, { idKind: 'payment', refundPending: noDispensa });
  if (!queued) return null; // duplicado (ya estaba) — caso normal, no es novedad

  // Pagó de más (ej. $400 con pulse_value $250 → 1 pulso, sobran $150): se devuelve
  // solo el excedente; el pulso dispensa normal. El caso 0 pulsos ya lo cubre
  // refundPending (devuelve todo). Misma regla: no retener lo que no dispensa.
  if (!noDispensa && excess > 0) await flagExcessForRefund(queued);

  return { machine, amount, pulses, excess, noDispensa };
}

// Reconcilia una cuenta conectada en una ventana de tiempo. Devuelve cuántos
// pagos NUEVOS registró. Best-effort: si MP falla, loguea y sigue.
async function reconcileClient(clientId, { beginDate } = {}) {
  let results;
  try {
    results = await searchPayments(clientId, { beginDate });
  } catch (e) {
    console.error(`[reconcile] search falló (cliente ${clientId}): ${e.message}`);
    return 0;
  }

  let nuevos = 0;
  let hayReembolso = false;
  for (const p of results) {
    if (p.status !== 'approved') continue;
    const r = await registerPayment(p);
    if (!r) continue;
    nuevos++;
    if (r.noDispensa || r.excess > 0) hayReembolso = true;
    const extra = r.noDispensa ? ' · reembolso total' : r.excess > 0 ? ` · excedente $${r.excess} (parcial)` : '';
    console.log(`[reconcile] + pago ${p.id} $${r.amount} → ${r.machine.id} (${r.pulses}p${extra})`);
  }
  if (hayReembolso) await processPendingRefunds();
  return nuevos;
}

// ─── On-demand: atado al poll del Arduino ───────────────────────────────────────
// Cuando el Arduino pollea, forzamos un refresco de la cuenta de su máquina: es
// el momento justo (alguien acaba de pagar y espera el producto). Throttle por
// cliente para no pegarle a MP en cada poll de 3s. Fire-and-forget: no bloquea
// la respuesta del poll; el pago recién entrado aparece en el poll siguiente (≤3s después).
const ONDEMAND_THROTTLE_MS = 5_000;
const _lastByClient = new Map(); // client_id → último timestamp reconciliado

export function reconcileMachineSoon(machine) {
  const clientId = machine?.client_id;
  if (!clientId || !machine.pos_id) return; // sin cuenta conectada o sin caja, nada que hacer
  const now = Date.now();
  if (now - (_lastByClient.get(clientId) || 0) < ONDEMAND_THROTTLE_MS) return; // throttle
  _lastByClient.set(clientId, now);
  reconcileClient(clientId, { beginDate: 'NOW-1HOURS' })
    .catch(e => console.error(`[reconcile] on-demand ${machine.id}: ${e.message}`));
}

// ─── Barrido de fondo: todas las cuentas conectadas ─────────────────────────────
// Corre cada pocos minutos para que el dashboard quede coherente aunque ningún
// Arduino esté polleando. Ventana más amplia (6h) + dedup cubre huecos/reinicios.
export async function reconcileAll() {
  const clients = await listConnectedClientIds();
  let total = 0;
  for (const cid of clients) {
    total += await reconcileClient(cid, { beginDate: 'NOW-6HOURS' });
  }
  if (total > 0) console.log(`[reconcile] barrido: ${total} pago(s) nuevo(s) reconciliado(s)`);
  return total;
}

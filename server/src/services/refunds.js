import db from '../db/schema.js';
import { refundOrder, refundPaymentMP } from './mp.js';

// Marca pagos para reembolso TOTAL (refund_status = 'pending'). Lo llaman el sweep
// de expiración (pulsos que no acreditaron) y el webhook (máquina fuera de
// servicio). Escala cualquier pago no terminado a total: si ya tenía un parcial de
// excedente ('partial') y el pulso después falla, se devuelve el resto (MP acumula
// parciales hasta el total). No toca los ya reembolsados ('done' / refunded_at).
export async function flagPaymentsForRefund(paymentIds) {
  const ids = [...new Set((paymentIds || []).filter(Boolean))];
  if (ids.length === 0) return 0;
  const r = await db.prepare(`
    UPDATE payments
    SET refund_status = 'pending'
    WHERE id IN (${ids.map(() => '?').join(',')})
      AND refunded_at IS NULL
      AND (refund_status IS NULL OR refund_status != 'done')
  `).run(...ids);
  return r.changes;
}

// Marca un pago para reembolso PARCIAL de excedente (lo ejecuta processPendingRefunds
// → refundExcess). Solo para pagos libres con pulsos donde sobró plata.
export async function flagExcessForRefund(paymentId) {
  if (!paymentId) return 0;
  const r = await db.prepare(`
    UPDATE payments SET refund_status = 'excess_pending'
    WHERE id = ?
      AND refunded_at IS NULL
      AND (refund_status IS NULL OR refund_status = 'excess_failed')
  `).run(paymentId);
  return r.changes;
}

// El reembolso mueve plata en la cuenta de MP del cliente dueño de la máquina,
// así que resolvemos su client_id para usar el token correcto.
async function clientOfPayment(p) {
  const machine = await db.prepare('SELECT client_id FROM machines WHERE id = ?').get(p.machine_id);
  return machine?.client_id || null;
}

// Llama a MP según el tipo de id guardado. Si no sabemos el tipo (filas viejas),
// intentamos order y caemos a payment.
async function callRefund(p) {
  const clientId = await clientOfPayment(p);
  if (p.mp_id_kind === 'payment') return refundPaymentMP(p.mp_payment_id, clientId);
  if (p.mp_id_kind === 'order') return refundOrder(p.mp_payment_id, clientId);
  try { return await refundOrder(p.mp_payment_id, clientId); }
  catch { return refundPaymentMP(p.mp_payment_id, clientId); }
}

// Un pago reembolsado no debe dispensar: se eliminan sus pulsos que sigan en
// cola (pending/delivered). Los acked no se tocan (ya salió el producto).
async function dropQueuedPulses(paymentId) {
  const r = await db.prepare(`
    DELETE FROM pulse_queue
    WHERE payment_id = ? AND status IN ('pending', 'delivered')
  `).run(paymentId);
  if (r.changes > 0) console.log(`[refund] ${r.changes} pulso(s) en cola eliminado(s) del pago ${paymentId}`);
  return r.changes;
}

// Ejecuta el reembolso de UN pago ya cargado y actualiza su fila. Devuelve
// { ok, error? }. No vuelve a llamar a MP si ya está reembolsado.
async function refundOne(p) {
  if (p.refunded_at) return { ok: true, already: true };
  if (!p.mp_payment_id) {
    await db.prepare(`UPDATE payments SET refund_status = 'failed', refund_error = 'sin mp_payment_id' WHERE id = ?`).run(p.id);
    return { ok: false, error: 'sin mp_payment_id' };
  }
  try {
    await callRefund(p);
    await db.prepare(`UPDATE payments SET refund_status = 'done', refunded_at = datetime('now'), refunded_amount = ?, refund_error = NULL WHERE id = ?`).run(p.amount, p.id);
    await dropQueuedPulses(p.id);
    console.log(`[refund] ✓ pago ${p.id} (${p.mp_id_kind || '?'} ${p.mp_payment_id}) reembolsado`);
    return { ok: true };
  } catch (e) {
    await db.prepare(`UPDATE payments SET refund_status = 'failed', refund_error = ? WHERE id = ?`).run(e.message, p.id);
    // Aunque MP haya fallado (se reintenta solo), el pulso no debe dispensar.
    await dropQueuedPulses(p.id);
    console.error(`[refund] ✗ pago ${p.id}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Reembolso PARCIAL del excedente de un pago: la parte que no alcanza a dispensar
// (monto − pulsos*pulse_value). Solo aplica a pagos libres/tipeados (QR dinámico,
// idKind 'payment'); los fijos no pueden pagar de más. Deja el pago en 'partial'
// (excedente devuelto, el/los pulso(s) siguen vivos y pueden dispensar). Si el
// pulso después falla, flagPaymentsForRefund lo escala a 'pending' y se devuelve
// el resto. Idempotency-key propia ('refund-excess-…') para no pisar un total.
async function refundExcess(p) {
  const m = await db.prepare('SELECT client_id, pulse_value FROM machines WHERE id = ?').get(p.machine_id);
  const excess = p.amount - (p.pulses_calculated || 0) * (m?.pulse_value || 0);
  if (excess <= 0) { // sin excedente real (ej. cambió la config) → nada que devolver
    await db.prepare(`UPDATE payments SET refund_status = 'partial', refunded_amount = 0 WHERE id = ?`).run(p.id);
    return { ok: true, excess: 0 };
  }
  if (!p.mp_payment_id) {
    await db.prepare(`UPDATE payments SET refund_status = 'excess_failed', refund_error = 'sin mp_payment_id' WHERE id = ?`).run(p.id);
    return { ok: false, error: 'sin mp_payment_id' };
  }
  try {
    await refundPaymentMP(p.mp_payment_id, m?.client_id || null, { amount: excess, idempotencyKey: `refund-excess-${p.mp_payment_id}` });
    await db.prepare(`UPDATE payments SET refund_status = 'partial', refunded_amount = ?, refund_error = NULL WHERE id = ?`).run(excess, p.id);
    console.log(`[refund] ✓ excedente $${excess} del pago ${p.id} (${p.mp_payment_id}) devuelto (parcial)`);
    return { ok: true, excess };
  } catch (e) {
    await db.prepare(`UPDATE payments SET refund_status = 'excess_failed', refund_error = ? WHERE id = ?`).run(e.message, p.id);
    console.error(`[refund] ✗ excedente pago ${p.id}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Procesa los pagos marcados para reembolso. Total: 'pending'/'failed'. Parcial de
// excedente: 'excess_pending'/'excess_failed'. Idempotente: el gate de refunded_at
// + las idempotency-keys de MP evitan reembolsar dos veces. Reintenta los failed.
export async function processPendingRefunds() {
  const pend = await db.prepare(`
    SELECT * FROM payments
    WHERE refund_status IN ('pending', 'failed') AND refunded_at IS NULL
  `).all();
  for (const p of pend) await refundOne(p);

  const exc = await db.prepare(`
    SELECT * FROM payments
    WHERE refund_status IN ('excess_pending', 'excess_failed') AND refunded_at IS NULL
  `).all();
  for (const p of exc) await refundExcess(p);
}

// Reembolso manual de un pago puntual (botón "Devolver" en la UI: test o
// corrección a mano). Devuelve { ok, status, error?, already? }.
export async function refundPaymentById(paymentId) {
  const p = await db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) return { ok: false, status: 404, error: 'Pago no encontrado' };
  if (p.refunded_at) return { ok: true, status: 200, already: true };
  if (p.status !== 'approved') return { ok: false, status: 409, error: 'El pago no está aprobado, no se puede reembolsar' };

  await db.prepare(`UPDATE payments SET refund_status = 'pending' WHERE id = ?`).run(p.id);
  const r = await refundOne(p);
  if (!r.ok) return { ok: false, status: 502, error: r.error };
  return { ok: true, status: 200 };
}

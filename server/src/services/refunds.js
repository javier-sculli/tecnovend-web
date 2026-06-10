import db from '../db/schema.js';
import { refundOrder, refundPaymentMP } from './mp.js';

// Marca pagos para reembolso (refund_status = 'pending') sin pisar los ya
// resueltos. Lo llaman el sweep de expiración (pulsos que no acreditaron) y el
// webhook (pagos a máquina fuera de servicio).
export function flagPaymentsForRefund(paymentIds) {
  const ids = [...new Set((paymentIds || []).filter(Boolean))];
  if (ids.length === 0) return 0;
  const r = db.prepare(`
    UPDATE payments
    SET refund_status = 'pending'
    WHERE id IN (${ids.map(() => '?').join(',')})
      AND refunded_at IS NULL
      AND (refund_status IS NULL OR refund_status = 'failed')
  `).run(...ids);
  return r.changes;
}

// Llama a MP según el tipo de id guardado. Si no sabemos el tipo (filas viejas),
// intentamos order y caemos a payment.
async function callRefund(p) {
  if (p.mp_id_kind === 'payment') return refundPaymentMP(p.mp_payment_id);
  if (p.mp_id_kind === 'order') return refundOrder(p.mp_payment_id);
  try { return await refundOrder(p.mp_payment_id); }
  catch { return refundPaymentMP(p.mp_payment_id); }
}

// Ejecuta el reembolso de UN pago ya cargado y actualiza su fila. Devuelve
// { ok, error? }. No vuelve a llamar a MP si ya está reembolsado.
async function refundOne(p) {
  if (p.refunded_at) return { ok: true, already: true };
  if (!p.mp_payment_id) {
    db.prepare(`UPDATE payments SET refund_status = 'failed', refund_error = 'sin mp_payment_id' WHERE id = ?`).run(p.id);
    return { ok: false, error: 'sin mp_payment_id' };
  }
  try {
    await callRefund(p);
    db.prepare(`UPDATE payments SET refund_status = 'done', refunded_at = datetime('now'), refund_error = NULL WHERE id = ?`).run(p.id);
    console.log(`[refund] ✓ pago ${p.id} (${p.mp_id_kind || '?'} ${p.mp_payment_id}) reembolsado`);
    return { ok: true };
  } catch (e) {
    db.prepare(`UPDATE payments SET refund_status = 'failed', refund_error = ? WHERE id = ?`).run(e.message, p.id);
    console.error(`[refund] ✗ pago ${p.id}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Procesa todos los pagos marcados para reembolso (pending o failed que no se
// completaron). Idempotente: el gate de refunded_at + la idempotency-key de MP
// evitan reembolsar dos veces. Reintenta los failed en la próxima pasada.
export async function processPendingRefunds() {
  const pend = db.prepare(`
    SELECT * FROM payments
    WHERE refund_status IN ('pending', 'failed') AND refunded_at IS NULL
  `).all();
  for (const p of pend) await refundOne(p);
}

// Reembolso manual de un pago puntual (botón "Devolver" en la UI: test o
// corrección a mano). Devuelve { ok, status, error?, already? }.
export async function refundPaymentById(paymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) return { ok: false, status: 404, error: 'Pago no encontrado' };
  if (p.refunded_at) return { ok: true, status: 200, already: true };
  if (p.status !== 'approved') return { ok: false, status: 409, error: 'El pago no está aprobado, no se puede reembolsar' };

  db.prepare(`UPDATE payments SET refund_status = 'pending' WHERE id = ?`).run(p.id);
  const r = await refundOne(p);
  if (!r.ok) return { ok: false, status: 502, error: r.error };
  return { ok: true, status: 200 };
}

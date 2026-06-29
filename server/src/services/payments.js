import crypto from 'crypto';
import db from '../db/schema.js';

// Registro de pagos y encolado de pulsos. Vive acá (no en el router del webhook)
// porque lo usan DOS fuentes: el webhook de MP y la reconciliación periódica
// (services/reconcile.js). La lógica de pago/pulso es única e idéntica para ambas;
// solo cambia la fuente del dato. Dedup por mp_payment_id UNIQUE evita doble carga.

function genPulseId() { return 'p_' + crypto.randomBytes(2).toString('hex'); }
function genPaymentId() { return crypto.randomUUID(); }

// Discriminador único: ¿este pago viene de una orden creada por NOSOTROS?
// Nuestras órdenes (precio fijo / on-demand) llevan external_reference 'tv_<id>_<ts>'
// y las maneja el webhook de `order` (bajo el id de la ORDEN). El mismo pago también
// aparece como merchant_order y en /payments/search (bajo el id del PAGO, distinto),
// así que SIN este filtro se registraría dos veces. Las dos vías que usan id de pago
// — webhook merchant_order y reconciliación — deben saltarlo. Los pagos libres
// (cliente tipea el monto, sin orden previa) NO tienen 'tv_' → esos sí se procesan.
export function isOurOrderRef(ref) {
  return String(ref || '').startsWith('tv_');
}

// Resuelve la máquina por su pos_id, sin filtrar por status: el pago SIEMPRE se
// registra (CLAUDE.md). El status define después si corresponden pulsos o no.
export async function findMachine(posId) {
  if (!posId) return null;
  return await db.prepare('SELECT * FROM machines WHERE pos_id = ? OR mp_pos_id = ?')
    .get(posId, posId) || null;
}

// Registra el pago y, si corresponde, encola el pulso. `idKind` indica si `mpId`
// es un id de 'order' o de 'payment' (define por qué endpoint se reembolsa).
// `refundPending` marca el pago para reembolso (caso fuera de servicio).
// Devuelve el paymentId creado, o null si era duplicado.
export async function enqueuePayment(machineId, mpId, amount, pulses, { idKind, refundPending = false } = {}) {
  // Pago y pulso se insertan en UNA transacción: o entran los dos o ninguno. Si el
  // INSERT del pulso falla, el del pago también se revierte (ROLLBACK) y el próximo
  // intento (webhook/reconciliación) lo reprocesa limpio. Antes eran dos INSERT
  // sueltos: si el segundo fallaba, el pago quedaba con pulses_calculated>0 pero sin
  // fila en pulse_queue → ni dispensaba ni se reembolsaba (limbo permanente, porque
  // la dedup por mp_payment_id impedía reintentar). Red de seguridad para filas
  // viejas rotas: findPaymentsMissingPulses (services/pulses.js).
  return await db.transaction(async (tx) => {
    const existing = await tx.prepare('SELECT id FROM payments WHERE mp_payment_id = ?').get(mpId);
    if (existing) return null; // deduplicación

    const paymentId = genPaymentId();

    // Siempre registramos el pago en la BD (aunque pulses=0 por monto insuficiente)
    const status = 'approved'; // MP aprobó el pago — independiente de pulsos
    await tx.prepare(`
      INSERT INTO payments (id, machine_id, mp_payment_id, amount, method, status, pulses_calculated, mp_id_kind, refund_status)
      VALUES (?, ?, ?, ?, 'qr', ?, ?, ?, ?)
    `).run(paymentId, machineId, mpId, amount, status, pulses, idKind ?? null, refundPending ? 'pending' : null);

    if (pulses >= 1) {
      // Ventana de ACK: 3 minutos. Si el Arduino no confirma en ese tiempo, el
      // pulso se expira (se saca de la cola, no acreditó) y se reembolsa el pago.
      // OJO: expires_at se calcula con datetime() de SQLite (formato 'YYYY-MM-DD
      // HH:MM:SS') para que coincida con datetime('now') del barrido. Un ISO de JS
      // (con 'T' y 'Z') compara como string SIEMPRE mayor → el pulso nunca expira.
      await tx.prepare(`
        INSERT INTO pulse_queue (id, machine_id, payment_id, channel, count, expires_at)
        VALUES (?, ?, ?, 1, ?, datetime('now', '+3 minutes'))
      `).run(genPulseId(), machineId, paymentId, pulses);
    }

    return paymentId;
  });
}


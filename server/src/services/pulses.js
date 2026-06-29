import db from '../db/schema.js';

// Pulsos que pasaron su ventana de ACK (expires_at) sin confirmarse: los
// sacamos de la cola marcándolos como 'expired' (= no acreditaron). Cubre tanto
// los pendientes como los ya entregados al Arduino que nunca mandaron ACK.
// Devuelve las filas expiradas en esta pasada ({ id, payment_id }) — sirven
// para disparar el reembolso del pago asociado.
export async function expireStalePulses() {
  // expires_at se guarda en el formato de SQLite ('YYYY-MM-DD HH:MM:SS', vía
  // datetime() al encolar) para que esta comparación de strings sea válida. NO
  // guardar acá un ISO de JS ('...T...Z'): compara como string SIEMPRE mayor que
  // datetime('now') y el pulso nunca expiraría.
  const stale = await db.prepare(`
    SELECT id, payment_id FROM pulse_queue
    WHERE status IN ('pending', 'delivered') AND expires_at < datetime('now')
  `).all();
  if (stale.length === 0) return [];

  const ids = stale.map(s => s.id);
  await db.prepare(`UPDATE pulse_queue SET status = 'expired' WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(...ids);
  return stale;
}

// Red de seguridad: pagos que calcularon pulsos (pulses_calculated >= 1) pero NO
// tienen NINGUNA fila en pulse_queue. Con enqueuePayment ahora atómico no debería
// pasar, pero cubre filas viejas rotas de antes del fix. Es un limbo invisible: sin
// pulso no dispensa, y el barrido de expiración solo mira filas existentes → nunca
// se reembolsa solo. Acá los detectamos para marcarlos a reembolso (regla única: si
// no se dispensa nada, no se retiene la plata). Grace de 2 min para no pisar un pago
// recién insertado. Excluye los ya reembolsados/en proceso. Devuelve los payment_id.
export async function findPaymentsMissingPulses() {
  const rows = await db.prepare(`
    SELECT p.id FROM payments p
    WHERE p.pulses_calculated >= 1
      AND p.refund_status IS NULL
      AND p.refunded_at IS NULL
      AND p.created_at < datetime('now', '-2 minutes')
      AND NOT EXISTS (SELECT 1 FROM pulse_queue q WHERE q.payment_id = p.id)
  `).all();
  return rows.map(r => r.id);
}


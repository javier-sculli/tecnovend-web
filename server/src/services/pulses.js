import db from '../db/schema.js';

// Pulsos que pasaron su ventana de ACK (expires_at) sin confirmarse: los
// sacamos de la cola marcándolos como 'expired' (= no acreditaron). Cubre tanto
// los pendientes como los ya entregados al Arduino que nunca mandaron ACK.
// Devuelve las filas expiradas en esta pasada ({ id, payment_id }) — sirven
// para disparar el reembolso del pago asociado.
export function expireStalePulses() {
  // expires_at se guarda en el formato de SQLite ('YYYY-MM-DD HH:MM:SS', vía
  // datetime() al encolar) para que esta comparación de strings sea válida. NO
  // guardar acá un ISO de JS ('...T...Z'): compara como string SIEMPRE mayor que
  // datetime('now') y el pulso nunca expiraría.
  const stale = db.prepare(`
    SELECT id, payment_id FROM pulse_queue
    WHERE status IN ('pending', 'delivered') AND expires_at < datetime('now')
  `).all();
  if (stale.length === 0) return [];

  const ids = stale.map(s => s.id);
  db.prepare(`UPDATE pulse_queue SET status = 'expired' WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(...ids);
  return stale;
}

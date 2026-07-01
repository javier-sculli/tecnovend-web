// Estado de conexión de la máquina — fuente de verdad única.
//
// Una máquina se considera "perdida"/offline cuando pasó más de OFFLINE_AFTER_MS
// sin latir (heartbeat). Este es el mismo umbral que la web pinta en rojo y el
// que dispara el aviso por mail (services/offline-alerts.js). Si algún día lo
// cambiamos, se cambia acá y aplica en todos lados.
export const OFFLINE_AFTER_MS = 60 * 60_000; // 1 hora
export const OFFLINE_AFTER_MIN = OFFLINE_AFTER_MS / 60_000;

// Estado consolidado de la máquina, en un solo campo `state`:
//   online          → latió en la última hora y está en servicio  (verde)
//   out_of_service  → latió, pero avisó que está fuera de servicio (amarillo)
//   offline         → no latió en la última hora / nunca latió      (rojo)
//
// La conexión manda: sin heartbeat reciente no podemos saber nada de la
// máquina, así que es `offline` aunque su último status fuera 'active'.
export function machineState(machine) {
  const ts = machine.last_seen_at;
  const ageMs = ts
    ? Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()
    : Infinity;
  if (ageMs >= OFFLINE_AFTER_MS) return 'offline';
  if (machine.status !== 'active') return 'out_of_service';
  return 'online';
}

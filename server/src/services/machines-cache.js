import db from '../db/schema.js';

// Cache en memoria: key -> { machine, expiresAt }
const cache = new Map();
// TTL de seguridad por si alguien modifica la base directamente sin pasar por la API
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutos

export function invalidateMachineCache(machineIdOrKey) {
  if (machineIdOrKey) {
    const target = String(machineIdOrKey).trim();
    for (const [k, v] of cache.entries()) {
      if (
        k === target ||
        v.machine?.id === target ||
        v.machine?.arduino_id === target ||
        v.machine?.device_serial === target ||
        v.machine?.pos_id === target ||
        v.machine?.mp_pos_id === target
      ) {
        cache.delete(k);
      }
    }
  } else {
    cache.clear();
  }
}

export async function getCachedMachine(key) {
  if (!key) return null;
  const lookupKey = String(key).trim();
  const now = Date.now();
  const cached = cache.get(lookupKey);

  if (cached && cached.expiresAt > now) {
    return cached.machine;
  }

  const machine = await db.prepare(`
    SELECT * FROM machines 
    WHERE arduino_id = ? OR id = ? OR pos_id = ? OR mp_pos_id = ? OR device_serial = ?
  `).get(lookupKey, lookupKey, lookupKey, lookupKey, lookupKey);

  if (machine) {
    const entry = { machine, expiresAt: now + DEFAULT_TTL_MS };
    // Mapear bajo todos sus identificadores posibles para que cualquier ruta acierte en caché
    if (machine.id) cache.set(String(machine.id), entry);
    if (machine.arduino_id) cache.set(String(machine.arduino_id), entry);
    if (machine.device_serial) cache.set(String(machine.device_serial), entry);
    if (machine.pos_id) cache.set(String(machine.pos_id), entry);
    if (machine.mp_pos_id) cache.set(String(machine.mp_pos_id), entry);
    cache.set(lookupKey, entry);
  } else {
    // Si la máquina no existe, cachear negativo brevemente (10 segundos) para no saturar la DB ante IDs inválidos
    cache.set(lookupKey, { machine: null, expiresAt: now + 10_000 });
  }

  return machine;
}

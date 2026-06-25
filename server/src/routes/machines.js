import { Router } from 'express';
import db from '../db/schema.js';
import { armFixedQR } from '../services/qr.js';
import { refundPaymentById } from '../services/refunds.js';
import { provisionMachinePos } from '../services/mp.js';

const router = Router();

// Estado consolidado de la máquina, en un solo campo `state`:
//   online          → latió en la última hora y está en servicio  (verde)
//   out_of_service  → latió, pero avisó que está fuera de servicio (amarillo)
//   offline         → no latió en la última hora / nunca latió      (rojo)
//
// La conexión manda: sin heartbeat reciente no podemos saber nada de la
// máquina, así que es `offline` aunque su último status fuera 'active'.
function machineState(machine) {
  const ts = machine.last_seen_at;
  const ageMs = ts
    ? Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()
    : Infinity;
  if (ageMs >= 60 * 60_000) return 'offline';
  if (machine.status !== 'active') return 'out_of_service';
  return 'online';
}

router.get('/', async (req, res) => {
  // Scoping opcional por organización (header x-org-id). La validación de
  // membresía está desactivada por ahora junto con el requireAuth global.
  const orgId = req.headers['x-org-id'] || null;
  const machines = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS payments_week,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS revenue_week
    FROM machines m
    ${orgId ? 'WHERE m.client_id = ?' : ''}
    ORDER BY m.created_at DESC
  `).all(...(orgId ? [orgId] : []));
  res.json(machines.map(m => ({
    ...m,
    channels_config: JSON.parse(m.channels_config),
    state: machineState(m),
  })));
});

router.post('/', async (req, res) => {
  const {
    id, name, location, address, model, device_serial, arduino_id, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value = 200, min_payment = 200, channels_config = [],
    wifi_ssid, wifi_user, wifi_password,
    qr_mode = 'dynamic', qr_fixed_amount,
  } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
  if (!['dynamic', 'fixed'].includes(qr_mode)) return res.status(400).json({ error: "qr_mode debe ser 'dynamic' o 'fixed'" });

  // El serial de la placa ES el identificador del Arduino: arduino_id y
  // device_serial son lo mismo. Aceptamos cualquiera de los dos del front y
  // guardamos el mismo valor en ambas columnas.
  const serial = (arduino_id ?? device_serial)?.trim() || null;

  if (serial) {
    const existing = await db.prepare('SELECT id, name FROM machines WHERE arduino_id = ? OR device_serial = ?').get(serial, serial);
    if (existing) {
      return res.status(400).json({ error: `El Arduino ID/Serial "${serial}" ya está asignado a la máquina "${existing.name}" (ID: ${existing.id})` });
    }
  }

  await db.prepare(`
    INSERT INTO machines
      (id, name, location, address, model, device_serial, arduino_id, api_key,
       pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
       pulse_value, min_payment, channels_config,
       wifi_ssid, wifi_user, wifi_password,
       qr_mode, qr_fixed_amount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, name, location ?? null, address ?? null, model ?? null,
    serial, serial, api_key ?? null,
    pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
    mp_store_id ?? null, mp_store_name ?? null, client_id ?? null,
    pulse_value, min_payment, JSON.stringify(channels_config),
    wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
    qr_mode, qr_fixed_amount ?? null,
  );

  // Provisión automática en MP: local default compartido + caja propia de la
  // máquina, asociada acá mismo. Best-effort: la máquina queda creada aunque MP
  // falle (se puede reintentar desde el detalle → solapa Pagos).
  let mp = null, mp_error = null;
  try {
    const created = await db.prepare('SELECT * FROM machines WHERE id = ?').get(id);
    mp = await provisionMachinePos(created);
    console.log(`[machines] ✓ ${id} provisionada en MP → caja ${mp.mp_pos_id} (local ${mp.store_id})`);
  } catch (e) {
    mp_error = e.message;
    console.error(`[machines] ✗ provisión MP de ${id} falló: ${e.message}`);
  }

  res.status(201).json({ id, mp, mp_error });
});

router.get('/:id', async (req, res) => {
  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  const payments = await db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({
    ...machine,
    channels_config: JSON.parse(machine.channels_config),
    state: machineState(machine),
    payments,
  });
});

router.put('/:id', async (req, res) => {
  const {
    name, location, address, model, device_serial, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value, min_payment, channels_config, status,
    pulse_duration_ms, pulse_gap_ms,
    wifi_ssid, wifi_user, wifi_password,
    qr_mode, qr_fixed_amount,
  } = req.body;
  const machine = await db.prepare('SELECT id FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  // Validar unicidad del Arduino ID/Serial si se intenta modificar
  let newSerial = undefined;
  const hasArduinoId = Object.prototype.hasOwnProperty.call(req.body, 'arduino_id');
  const hasDeviceSerial = Object.prototype.hasOwnProperty.call(req.body, 'device_serial');

  if (hasArduinoId) {
    newSerial = req.body.arduino_id?.trim() || null;
  } else if (hasDeviceSerial) {
    newSerial = device_serial?.trim() || null;
  }

  if (newSerial !== undefined && newSerial !== null) {
    const existing = await db.prepare('SELECT id, name FROM machines WHERE (arduino_id = ? OR device_serial = ?) AND id != ?').get(newSerial, newSerial, req.params.id);
    if (existing) {
      return res.status(400).json({ error: `El Arduino ID/Serial "${newSerial}" ya está asignado a la máquina "${existing.name}" (ID: ${existing.id})` });
    }
  }

  if (qr_mode !== undefined && !['dynamic', 'fixed'].includes(qr_mode)) {
    return res.status(400).json({ error: "qr_mode debe ser 'dynamic' o 'fixed'" });
  }
  if (qr_mode === 'fixed') {
    const amt = Number(qr_fixed_amount);
    if (!Number.isInteger(amt) || amt < 15) {
      return res.status(400).json({ error: 'qr_fixed_amount requerido y debe ser >= $15 (mínimo de Mercado Pago)' });
    }
  }

  await db.prepare(`
    UPDATE machines SET
      name              = COALESCE(?, name),
      location          = COALESCE(?, location),
      address           = COALESCE(?, address),
      model             = COALESCE(?, model),
      device_serial     = COALESCE(?, device_serial),
      api_key           = COALESCE(?, api_key),
      pos_id            = COALESCE(?, pos_id),
      terminal_id       = COALESCE(?, terminal_id),
      mp_pos_id         = COALESCE(?, mp_pos_id),
      mp_store_id       = COALESCE(?, mp_store_id),
      mp_store_name     = COALESCE(?, mp_store_name),
      client_id         = COALESCE(?, client_id),
      pulse_value       = COALESCE(?, pulse_value),
      min_payment       = COALESCE(?, min_payment),
      channels_config   = COALESCE(?, channels_config),
      status            = COALESCE(?, status),
      pulse_duration_ms = COALESCE(?, pulse_duration_ms),
      pulse_gap_ms      = COALESCE(?, pulse_gap_ms),
      wifi_ssid         = COALESCE(?, wifi_ssid),
      wifi_user         = COALESCE(?, wifi_user),
      wifi_password     = COALESCE(?, wifi_password),
      qr_mode           = COALESCE(?, qr_mode),
      qr_fixed_amount   = COALESCE(?, qr_fixed_amount)
    WHERE id = ?
  `).run(
    name ?? null, location ?? null, address ?? null, model ?? null,
    device_serial ?? null, api_key ?? null,
    pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
    mp_store_id ?? null, mp_store_name ?? null, client_id ?? null,
    pulse_value ?? null, min_payment ?? null,
    channels_config ? JSON.stringify(channels_config) : null,
    status ?? null,
    pulse_duration_ms ?? null, pulse_gap_ms ?? null,
    wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
    qr_mode ?? null, qr_fixed_amount != null ? Number(qr_fixed_amount) : null,
    req.params.id,
  );

  // arduino_id (= serial de placa) necesita manejo explícito: COALESCE no permite
  // desvincular (null) ni dejarlo vacío. Si el body incluye la clave, la aplicamos
  // tal cual a ambas columnas (arduino_id y device_serial son lo mismo).
  // Sincronizar y actualizar arduino_id y device_serial si se modificaron
  if (newSerial !== undefined) {
    await db.prepare('UPDATE machines SET arduino_id = ?, device_serial = ? WHERE id = ?').run(newSerial, newSerial, req.params.id);
  }

  // client_id necesita manejo explícito: COALESCE no permite desvincular (null).
  // Si el body incluye la clave, la aplicamos tal cual (puede ser null = sin cliente).
  if (Object.prototype.hasOwnProperty.call(req.body, 'client_id')) {
    await db.prepare('UPDATE machines SET client_id = ? WHERE id = ?')
      .run(client_id ?? null, req.params.id);
  }

  // Si la config de QR quedó en precio fijo, cargamos la orden en el QR ahora.
  // Best-effort: el guardado no falla si MP no responde (queda qr_armed: false).
  let qr_armed;
  if (qr_mode !== undefined || qr_fixed_amount !== undefined) {
    const updated = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
    qr_armed = updated.qr_mode === 'fixed' ? await armFixedQR(updated) : undefined;
  }

  res.json({ ok: true, ...(qr_armed !== undefined ? { qr_armed } : {}) });
});

// Elimina la máquina y todo lo que cuelga de ella (FK: hay que borrar hijos
// primero). No toca la caja en MP — el local/caja del cliente quedan en su cuenta.
router.delete('/:id', async (req, res) => {
  const machine = await db.prepare('SELECT id FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  try {
    await db.exec('BEGIN');
    await db.prepare('DELETE FROM pulse_queue WHERE machine_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM payments WHERE machine_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM machine_events WHERE machine_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM machines WHERE id = ?').run(req.params.id);
    await db.exec('COMMIT');
  } catch (e) {
    try { await db.exec('ROLLBACK'); } catch {}
    console.error('[machines/delete]', e.message);
    return res.status(500).json({ error: e.message });
  }

  console.log(`[machines] ✗ ${req.params.id} eliminada`);
  res.json({ ok: true });
});

router.get('/:id/payments', async (req, res) => {
  const payments = await db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(payments);
});

// Cola de pulsos de la máquina: pendientes y entregados arriba (en vuelo),
// luego el resto. La expiración la maneja el barrido periódico de index.js.
router.get('/:id/pulses', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const pulses = await db.prepare(`
    SELECT id, machine_id, payment_id, channel, count, status, created_at, acked_at, expires_at
    FROM pulse_queue
    WHERE machine_id = ?
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'delivered' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT ?
  `).all(req.params.id, limit);
  res.json(pulses);
});

// Eliminar un pulso de la cola (cancelación manual desde la web).
// Con ?refund=1 además devuelve el pago asociado en MP (idempotente; si MP
// falla queda 'failed' y el barrido lo reintenta solo).
router.delete('/:id/pulses/:pulseId', async (req, res) => {
  const pulse = await db.prepare('SELECT id, payment_id, status FROM pulse_queue WHERE id = ? AND machine_id = ?')
    .get(req.params.pulseId, req.params.id);
  if (!pulse) return res.status(404).json({ error: 'Pulso no encontrado' });

  await db.prepare('DELETE FROM pulse_queue WHERE id = ?').run(pulse.id);

  const wantRefund = req.query.refund === '1' || req.query.refund === 'true';
  if (!wantRefund) return res.json({ ok: true, refunded: false });

  if (!pulse.payment_id) return res.json({ ok: true, refunded: false, refund_error: 'pulso sin pago asociado' });
  const r = await refundPaymentById(pulse.payment_id);
  res.json({ ok: true, refunded: r.ok === true, refund_error: r.error || null });
});

// Feed de eventos unificado de la máquina. Junta tres fuentes:
//   - machine_events: heartbeat / config / service (logueados por el firmware)
//   - pulse_queue:    ACK de pulsos confirmados (ya persistido en prod)
//   - payments:       pagos aprobados/rechazados
// Devuelve una lista normalizada { type, kind, title, desc, at } ordenada por fecha.
router.get('/:id/events', async (req, res) => {
  const id = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 60, 500);

  const out = [];

  // 1) Eventos del firmware
  const events = await db.prepare(
    'SELECT type, detail, created_at FROM machine_events WHERE machine_id = ?'
  ).all(id);
  for (const e of events) {
    let d = {};
    try { d = e.detail ? JSON.parse(e.detail) : {}; } catch {}
    if (e.type === 'heartbeat') {
      const parts = [];
      if (d.rssi != null) parts.push(`${d.rssi} dBm`);
      if (d.uptime != null) parts.push(`uptime ${d.uptime}s`);
      if (d.fw) parts.push(`fw ${d.fw}`);
      
      let desc = parts.join(' · ') || 'señal de vida';
      let kind = 'ok';
      let title = 'Heartbeat';
      
      if (d.affected_pulse_id || d.reason === 'sale_timeout') {
        kind = 'warn';
        title = 'Heartbeat (Falla de Venta)';
        const failParts = [];
        if (d.reason) failParts.push(`motivo: ${d.reason}`);
        if (d.affected_pulse_id) failParts.push(`pulso: ${d.affected_pulse_id}`);
        desc = `${desc} ⚠️ [FALLA] ${failParts.join(' · ')}`;
      } else if (d.reason) {
        // Otros motivos no críticos (ej: startup, out_of_service) se muestran en la descripción normal
        desc = `${desc} · Motivo: ${d.reason === 'startup' ? 'inicio (startup)' : d.reason}`;
      }
      
      out.push({ type: e.type, kind, title, desc, at: e.created_at });
    } else if (e.type === 'config') {
      out.push({ type: e.type, kind: 'ok', title: 'Solicitó configuración', desc: d.pulse_value != null ? `pulse_value $${d.pulse_value}` : '', at: e.created_at });
    } else if (e.type === 'service') {
      out.push({ type: e.type, kind: d.in_service ? 'ok' : 'warn', title: d.in_service ? 'Volvió a servicio' : 'Fuera de servicio', desc: 'reportado por la máquina', at: e.created_at });
    } else {
      out.push({ type: e.type, kind: 'ok', title: e.type, desc: '', at: e.created_at });
    }
  }

  // 2) ACK de pulsos (derivado de pulse_queue)
  const acks = await db.prepare(
    `SELECT id, channel, count, acked_at FROM pulse_queue
     WHERE machine_id = ? AND status = 'acked' AND acked_at IS NOT NULL`
  ).all(id);
  for (const p of acks) {
    out.push({
      type: 'ack', kind: 'ok',
      title: 'Pulso confirmado (ACK)',
      desc: `canal ${p.channel} · ${p.count} pulso${p.count !== 1 ? 's' : ''} · ${p.id}`,
      at: p.acked_at,
    });
  }

  // 3) Pagos
  const payments = await db.prepare(
    'SELECT mp_payment_id, amount, status, pulses_calculated, created_at FROM payments WHERE machine_id = ?'
  ).all(id);
  for (const p of payments) {
    const approved = p.status === 'approved';
    out.push({
      type: 'payment',
      kind: approved ? (p.pulses_calculated > 0 ? 'ok' : 'warn') : 'bad',
      title: approved ? (p.pulses_calculated > 0 ? 'Pago aprobado' : 'Pago aprobado · sin pulsos') : `Pago ${p.status}`,
      desc: `$${p.amount} · ${p.pulses_calculated} pulso${p.pulses_calculated !== 1 ? 's' : ''}${p.mp_payment_id ? ' · ' + p.mp_payment_id : ''}`,
      at: p.created_at,
    });
  }

  out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  res.json(out.slice(0, limit));
});

export default router;

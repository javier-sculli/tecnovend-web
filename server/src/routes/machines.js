import { Router } from 'express';
import db from '../db/schema.js';

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

router.get('/', (req, res) => {
  const machines = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS payments_week,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS revenue_week
    FROM machines m
    ORDER BY m.created_at DESC
  `).all();
  res.json(machines.map(m => ({
    ...m,
    channels_config: JSON.parse(m.channels_config),
    state: machineState(m),
  })));
});

router.post('/', (req, res) => {
  const {
    id, name, location, address, model, device_serial, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value = 200, min_payment = 200, channels_config = [],
    wifi_ssid, wifi_user, wifi_password,
  } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });

  db.prepare(`
    INSERT INTO machines
      (id, name, location, address, model, device_serial, api_key,
       pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
       pulse_value, min_payment, channels_config,
       wifi_ssid, wifi_user, wifi_password)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, name, location ?? null, address ?? null, model ?? null,
    device_serial ?? null, api_key ?? null,
    pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
    mp_store_id ?? null, mp_store_name ?? null, client_id ?? null,
    pulse_value, min_payment, JSON.stringify(channels_config),
    wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
  );

  res.status(201).json({ id });
});

router.get('/:id', (req, res) => {
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  const payments = db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({
    ...machine,
    channels_config: JSON.parse(machine.channels_config),
    state: machineState(machine),
    payments,
  });
});

router.put('/:id', (req, res) => {
  const {
    name, location, address, model, device_serial, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value, min_payment, channels_config, status,
    pulse_duration_ms, pulse_gap_ms,
    wifi_ssid, wifi_user, wifi_password,
  } = req.body;
  const machine = db.prepare('SELECT id FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });

  db.prepare(`
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
      wifi_password     = COALESCE(?, wifi_password)
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
    req.params.id,
  );

  // arduino_id necesita manejo explícito: COALESCE no permite desvincular (null)
  // ni dejarlo vacío. Si el body incluye la clave, la aplicamos tal cual.
  if (Object.prototype.hasOwnProperty.call(req.body, 'arduino_id')) {
    const aid = req.body.arduino_id?.trim() || null;
    db.prepare('UPDATE machines SET arduino_id = ? WHERE id = ?').run(aid, req.params.id);
  }

  // client_id necesita manejo explícito: COALESCE no permite desvincular (null).
  // Si el body incluye la clave, la aplicamos tal cual (puede ser null = sin cliente).
  if (Object.prototype.hasOwnProperty.call(req.body, 'client_id')) {
    db.prepare('UPDATE machines SET client_id = ? WHERE id = ?')
      .run(client_id ?? null, req.params.id);
  }

  res.json({ ok: true });
});

router.get('/:id/payments', (req, res) => {
  const payments = db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(payments);
});

// Cola de pulsos de la máquina: pendientes y entregados arriba (en vuelo),
// luego el resto. La expiración la maneja el barrido periódico de index.js.
router.get('/:id/pulses', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const pulses = db.prepare(`
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
router.delete('/:id/pulses/:pulseId', (req, res) => {
  const r = db.prepare('DELETE FROM pulse_queue WHERE id = ? AND machine_id = ?')
    .run(req.params.pulseId, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Pulso no encontrado' });
  res.json({ ok: true });
});

// Feed de eventos unificado de la máquina. Junta tres fuentes:
//   - machine_events: heartbeat / config / service (logueados por el firmware)
//   - pulse_queue:    ACK de pulsos confirmados (ya persistido en prod)
//   - payments:       pagos aprobados/rechazados
// Devuelve una lista normalizada { type, kind, title, desc, at } ordenada por fecha.
router.get('/:id/events', (req, res) => {
  const id = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 60, 200);

  const out = [];

  // 1) Eventos del firmware
  for (const e of db.prepare(
    'SELECT type, detail, created_at FROM machine_events WHERE machine_id = ?'
  ).all(id)) {
    let d = {};
    try { d = e.detail ? JSON.parse(e.detail) : {}; } catch {}
    if (e.type === 'heartbeat') {
      const parts = [];
      if (d.rssi != null) parts.push(`${d.rssi} dBm`);
      if (d.uptime != null) parts.push(`uptime ${d.uptime}s`);
      if (d.fw) parts.push(`fw ${d.fw}`);
      out.push({ type: e.type, kind: 'ok', title: 'Heartbeat', desc: parts.join(' · ') || 'señal de vida', at: e.created_at });
    } else if (e.type === 'config') {
      out.push({ type: e.type, kind: 'ok', title: 'Solicitó configuración', desc: d.pulse_value != null ? `pulse_value $${d.pulse_value}` : '', at: e.created_at });
    } else if (e.type === 'service') {
      out.push({ type: e.type, kind: d.in_service ? 'ok' : 'warn', title: d.in_service ? 'Volvió a servicio' : 'Fuera de servicio', desc: 'reportado por la máquina', at: e.created_at });
    } else {
      out.push({ type: e.type, kind: 'ok', title: e.type, desc: '', at: e.created_at });
    }
  }

  // 2) ACK de pulsos (derivado de pulse_queue)
  for (const p of db.prepare(
    `SELECT id, channel, count, acked_at FROM pulse_queue
     WHERE machine_id = ? AND status = 'acked' AND acked_at IS NOT NULL`
  ).all(id)) {
    out.push({
      type: 'ack', kind: 'ok',
      title: 'Pulso confirmado (ACK)',
      desc: `canal ${p.channel} · ${p.count} pulso${p.count !== 1 ? 's' : ''} · ${p.id}`,
      at: p.acked_at,
    });
  }

  // 3) Pagos
  for (const p of db.prepare(
    'SELECT mp_payment_id, amount, status, pulses_calculated, created_at FROM payments WHERE machine_id = ?'
  ).all(id)) {
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

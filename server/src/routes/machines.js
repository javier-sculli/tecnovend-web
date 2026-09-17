import { Router } from 'express';
import db from '../db/schema.js';
import { armFixedQR } from '../services/qr.js';
import { refundPaymentById } from '../services/refunds.js';
import { provisionMachinePos } from '../services/mp.js';
import { machineState } from '../services/machine-state.js';
import { getEffectiveOrgContext } from '../middleware/auth.js';

const router = Router();

async function checkMachineAccess(req, res, machineId) {
  let ctx;
  try {
    ctx = await getEffectiveOrgContext(req);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
    return null;
  }

  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId);
  if (!machine) {
    res.status(404).json({ error: 'Máquina no encontrada' });
    return null;
  }

  if (!ctx.isSuperAdmin) {
    if (!machine.client_id || !ctx.allowedClientIds.includes(machine.client_id)) {
      res.status(403).json({ error: 'No tenés acceso a esta máquina' });
      return null;
    }
  }

  return { machine, ctx };
}

async function findMachineBySerial(serial) {
  if (!serial) return null;
  const clean = serial.trim();
  if (!clean) return null;

  let existing = await db.prepare(
    'SELECT * FROM machines WHERE arduino_id = ? OR device_serial = ? OR id = ?'
  ).get(clean, clean, clean);
  if (existing) return existing;

  const digitsMatch = clean.match(/^(?:ARD[ -]?)?0*(\d+)$/i);
  if (digitsMatch) {
    const num = digitsMatch[1];
    const padded = 'ARD-' + num.padStart(5, '0');
    const short = 'ARD-' + num;
    const space = 'ARD ' + num;
    existing = await db.prepare(
      'SELECT * FROM machines WHERE arduino_id = ? OR device_serial = ? OR arduino_id = ? OR device_serial = ? OR arduino_id = ? OR device_serial = ? OR arduino_id = ? OR device_serial = ?'
    ).get(padded, padded, short, short, space, space, num, num);
    if (existing) return existing;
  }

  return null;
}

router.get('/', async (req, res) => {
  let ctx;
  try {
    ctx = await getEffectiveOrgContext(req);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  const todayStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  
  let whereClause = '';
  let queryParams = [];

  if (!ctx.isSuperAdmin) {
    if (!ctx.allowedClientIds || ctx.allowedClientIds.length === 0) {
      return res.json([]);
    }
    const placeholders = ctx.allowedClientIds.map(() => '?').join(',');
    whereClause = `WHERE m.client_id IN (${placeholders})`;
    queryParams = [...ctx.allowedClientIds];
  } else if (ctx.activeOrgId) {
    whereClause = 'WHERE m.client_id = ?';
    queryParams = [ctx.activeOrgId];
  }

  const machines = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS payments_week,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= datetime('now', '-7 days')) AS revenue_week,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= '${todayStr}') AS today_total,
      (SELECT COUNT(*) FROM payments p
        WHERE p.machine_id = m.id AND p.status = 'approved'
          AND p.created_at >= '${todayStr}') AS today_count
    FROM machines m
    ${whereClause}
    ORDER BY m.created_at DESC
  `).all(...queryParams);

  res.json(machines.map(m => ({
    ...m,
    channels_config: JSON.parse(m.channels_config),
    state: machineState(m),
  })));
});

router.post('/', async (req, res) => {
  let ctx;
  try {
    ctx = await getEffectiveOrgContext(req);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  const {
    id, name, location, address, model, device_serial, arduino_id, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value = 200, min_payment = 200, channels_config = [],
    wifi_ssid, wifi_user, wifi_password,
    qr_mode = 'dynamic', qr_fixed_amount,
    poll_interval_s = 3,
  } = req.body;

  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
  if (!['dynamic', 'fixed'].includes(qr_mode)) return res.status(400).json({ error: "qr_mode debe ser 'dynamic' o 'fixed'" });

  let targetClientId = client_id || ctx.activeOrgId || (ctx.allowedClientIds?.length === 1 ? ctx.allowedClientIds[0] : null);

  if (!targetClientId) {
    return res.status(400).json({ error: 'Debes especificar o seleccionar un cliente (client_id) para la máquina' });
  }

  if (!ctx.isSuperAdmin) {
    if (!ctx.allowedClientIds.includes(targetClientId)) {
      return res.status(403).json({ error: 'No tenés permisos para agregar máquinas a esta organización' });
    }
  }

  const serial = (arduino_id ?? device_serial)?.trim() || null;

  if (serial) {
    const existing = await findMachineBySerial(serial);
    if (existing) {
      if (existing.client_id && existing.client_id !== targetClientId) {
        const owner = await db.prepare('SELECT name FROM clients WHERE id = ?').get(existing.client_id);
        const ownerName = owner ? owner.name : 'otra organización';
        return res.status(400).json({
          error: `El Arduino ID/Serial "${serial}" ya está asignado a la máquina "${existing.name}" del cliente "${ownerName}".`
        });
      }

      // Si la máquina está huérfana (client_id es NULL) o pertenece a esta misma organización:
      // Reasignar / adoptar la máquina existente actualizando sus datos
      const targetSerial = existing.arduino_id || existing.device_serial || serial;

      await db.prepare(`
        UPDATE machines SET
          name              = COALESCE(?, name),
          location          = COALESCE(?, location),
          address           = COALESCE(?, address),
          model             = COALESCE(?, model),
          device_serial     = ?,
          arduino_id        = ?,
          api_key           = COALESCE(?, api_key),
          pos_id            = COALESCE(?, pos_id),
          terminal_id       = COALESCE(?, terminal_id),
          mp_pos_id         = COALESCE(?, mp_pos_id),
          mp_store_id       = COALESCE(?, mp_store_id),
          mp_store_name     = COALESCE(?, mp_store_name),
          client_id         = ?,
          pulse_value       = ?,
          min_payment       = ?,
          channels_config   = ?,
          wifi_ssid         = COALESCE(?, wifi_ssid),
          wifi_user         = COALESCE(?, wifi_user),
          wifi_password     = COALESCE(?, wifi_password),
          qr_mode           = ?,
          qr_fixed_amount   = ?,
          poll_interval_s   = ?
        WHERE id = ?
      `).run(
        name ?? null, location ?? null, address ?? null, model ?? null,
        targetSerial, targetSerial, api_key ?? null,
        pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
        mp_store_id ?? null, mp_store_name ?? null, targetClientId,
        pulse_value, min_payment, JSON.stringify(channels_config),
        wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
        qr_mode, qr_fixed_amount ?? null, Number(poll_interval_s) || 3,
        existing.id
      );

      let mp = null, mp_error = null;
      try {
        const updated = await db.prepare('SELECT * FROM machines WHERE id = ?').get(existing.id);
        mp = await provisionMachinePos(updated);
        console.log(`[machines] ✓ ${existing.id} adoptada/reasignada a cliente ${targetClientId} y provisionada en MP → caja ${mp.mp_pos_id}`);
      } catch (e) {
        mp_error = e.message;
        console.error(`[machines] ✗ provisión MP de ${existing.id} falló: ${e.message}`);
      }

      return res.status(200).json({ id: existing.id, mp, mp_error, reassigned: true });
    }
  }

  await db.prepare(`
    INSERT INTO machines
      (id, name, location, address, model, device_serial, arduino_id, api_key,
       pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
       pulse_value, min_payment, channels_config,
       wifi_ssid, wifi_user, wifi_password,
       qr_mode, qr_fixed_amount, poll_interval_s)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, name, location ?? null, address ?? null, model ?? null,
    serial, serial, api_key ?? null,
    pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
    mp_store_id ?? null, mp_store_name ?? null, targetClientId ?? null,
    pulse_value, min_payment, JSON.stringify(channels_config),
    wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
    qr_mode, qr_fixed_amount ?? null, Number(poll_interval_s) || 3,
  );

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
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;
  const { machine } = access;

  const todayStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const todayStats = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS today_total, COUNT(*) AS today_count
    FROM payments
    WHERE machine_id = ? AND status = 'approved' AND created_at >= ?
  `).get(req.params.id, todayStr);

  const payments = await db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({
    ...machine,
    channels_config: JSON.parse(machine.channels_config),
    state: machineState(machine),
    today_total: Number(todayStats?.today_total || 0),
    today_count: Number(todayStats?.today_count || 0),
    payments,
  });
});

router.put('/:id', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;
  const { machine, ctx } = access;

  const {
    name, location, address, model, device_serial, api_key,
    pos_id, terminal_id, mp_pos_id, mp_store_id, mp_store_name, client_id,
    pulse_value, min_payment, channels_config, status,
    pulse_duration_ms, pulse_gap_ms,
    wifi_ssid, wifi_user, wifi_password,
    qr_mode, qr_fixed_amount,
    target_fw_version, ota_url,
    poll_interval_s,
  } = req.body;

  let newSerial = undefined;
  const hasArduinoId = Object.prototype.hasOwnProperty.call(req.body, 'arduino_id');
  const hasDeviceSerial = Object.prototype.hasOwnProperty.call(req.body, 'device_serial');

  if (hasArduinoId) {
    newSerial = req.body.arduino_id?.trim() || null;
  } else if (hasDeviceSerial) {
    newSerial = device_serial?.trim() || null;
  }

  if (newSerial !== undefined && newSerial !== null) {
    const existing = await findMachineBySerial(newSerial);
    if (existing && existing.id !== req.params.id) {
      if (existing.client_id) {
        const owner = await db.prepare('SELECT name FROM clients WHERE id = ?').get(existing.client_id);
        const ownerName = owner ? owner.name : 'otra organización';
        return res.status(400).json({ error: `El Arduino ID/Serial "${newSerial}" ya está asignado a la máquina "${existing.name}" del cliente "${ownerName}".` });
      }
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

  if (Object.prototype.hasOwnProperty.call(req.body, 'client_id') && client_id !== undefined) {
    if (!ctx.isSuperAdmin && client_id && !ctx.allowedClientIds.includes(client_id)) {
      return res.status(403).json({ error: 'No tenés acceso a esa organización' });
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
      qr_fixed_amount   = COALESCE(?, qr_fixed_amount),
      poll_interval_s   = COALESCE(?, poll_interval_s)
    WHERE id = ?
  `).run(
    name ?? null, location ?? null, address ?? null, model ?? null,
    device_serial ?? null, api_key ?? null,
    pos_id ?? null, terminal_id ?? null, mp_pos_id ?? null,
    mp_store_id ?? null, mp_store_name ?? null,
    pulse_value ?? null, min_payment ?? null,
    channels_config ? JSON.stringify(channels_config) : null,
    status ?? null,
    pulse_duration_ms ?? null, pulse_gap_ms ?? null,
    wifi_ssid ?? null, wifi_user ?? null, wifi_password ?? null,
    qr_mode ?? null, qr_fixed_amount != null ? Number(qr_fixed_amount) : null,
    poll_interval_s != null ? Number(poll_interval_s) : null,
    req.params.id,
  );

  if (newSerial !== undefined) {
    await db.prepare('UPDATE machines SET arduino_id = ?, device_serial = ? WHERE id = ?').run(newSerial, newSerial, req.params.id);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'client_id')) {
    await db.prepare('UPDATE machines SET client_id = ? WHERE id = ?')
      .run(client_id ?? null, req.params.id);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'target_fw_version')) {
    await db.prepare('UPDATE machines SET target_fw_version = ? WHERE id = ?')
      .run(target_fw_version || null, req.params.id);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'ota_url')) {
    await db.prepare('UPDATE machines SET ota_url = ? WHERE id = ?')
      .run(ota_url || null, req.params.id);
  }

  let qr_armed;
  if (qr_mode !== undefined || qr_fixed_amount !== undefined) {
    const updated = await db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
    qr_armed = updated.qr_mode === 'fixed' ? await armFixedQR(updated) : undefined;
  }

  res.json({ ok: true, ...(qr_armed !== undefined ? { qr_armed } : {}) });
});

router.delete('/:id', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

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
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

  const payments = await db.prepare('SELECT * FROM payments WHERE machine_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(payments);
});

router.get('/:id/pulses', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

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

router.delete('/:id/pulses/:pulseId', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

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

router.get('/:id/events', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

  const id = req.params.id;
  const limit = Math.min(Number(req.query.limit) || 60, 500);

  const out = [];

  const events = await db.prepare(
    "SELECT type, detail, created_at FROM machine_events WHERE machine_id = ? AND type != 'status_log'"
  ).all(id);

  const reasonTranslations = {
    startup: 'inicio (startup)',
    out_of_service: 'fuera de servicio',
    recovered: 'recuperación de servicio',
    sale_timeout: 'timeout de venta',
  };

  function fmtUptimeServer(sec) {
    if (sec == null) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const resetReasonTranslations = {
    poweron: 'Encendido / Reconexión eléctrica',
    external: 'Reinicio manual / Botón físico',
    software: 'Reinicio por software',
    'software: wifi stale': 'Reinicio por pérdida de WiFi',
    panic: 'Reinicio por falla interna',
    interrupt_wdt: 'Reinicio automático de control',
    task_wdt: 'Reinicio automático de control',
    watchdog: 'Reinicio automático de control',
    deepsleep: 'Salida de suspensión (deep sleep)',
    brownout: 'Baja tensión eléctrica (caída de energía)',
    sdio: 'Reinicio por SDIO',
    unknown: 'Reinicio por causa no especificada',
  };

  for (const e of events) {
    let d = {};
    try { d = e.detail ? JSON.parse(e.detail) : {}; } catch {}
    if (e.type === 'heartbeat') {
      const parts = [];
      if (d.rssi != null) parts.push(`${d.rssi} dBm`);
      if (d.uptime != null) parts.push(`uptime ${fmtUptimeServer(d.uptime)}`);
      if (d.fw) parts.push(`fw ${d.fw}`);

      let desc = parts.join(' · ') || 'señal de vida';
      let kind = 'ok';
      let title = 'Heartbeat';

      if (d.affected_pulse_id || d.reason === 'sale_timeout') {
        kind = 'warn';
        title = 'Heartbeat (Falla de Venta)';
        const failParts = [];
        if (d.reason) {
          const reasonText = reasonTranslations[d.reason] || d.reason;
          failParts.push(`motivo: ${reasonText}`);
        }
        if (d.affected_pulse_id) failParts.push(`pulso: ${d.affected_pulse_id}`);
        desc = `${desc} ⚠️ [FALLA] ${failParts.join(' · ')}`;
      } else if (d.reason === 'startup') {
        title = 'Heartbeat (Inicio)';
        const rrText = resetReasonTranslations[d.reset_reason_text] || d.reset_reason_text || 'Inicio de sistema';
        const meta = [];
        if (d.fw) meta.push(`fw ${d.fw}`);
        if (d.uptime != null) meta.push(`uptime ${fmtUptimeServer(d.uptime)}`);
        if (d.rssi != null) meta.push(`${d.rssi} dBm`);
        const secInfo = meta.length > 0 ? ` (${meta.join(' · ')})` : '';
        desc = `Motivo: ${rrText}${secInfo}`;
      } else if (d.reason && d.reason !== 'recovered' && d.reason !== 'out_of_service') {
        const reasonText = reasonTranslations[d.reason] || d.reason;
        desc = `${desc} · motivo: ${reasonText}`;
      }

      out.push({ type: e.type, kind, title, desc, at: e.created_at });
    } else if (e.type === 'config') {
      out.push({ type: e.type, kind: 'ok', title: 'Solicitó configuración', desc: d.pulse_value != null ? `pulse_value $${d.pulse_value}` : '', at: e.created_at });
    } else if (e.type === 'service') {
      out.push({ type: e.type, kind: d.in_service ? 'ok' : 'warn', title: d.in_service ? 'Volvió a servicio' : 'Fuera de servicio', desc: 'reportado por la máquina', at: e.created_at });
    } else if (e.type === 'bootloop') {
      out.push({ type: 'service', kind: 'bad', title: 'Alerta: Reinicios continuos (Bootloop)', desc: d.desc || 'La máquina se está reiniciando de forma repetida', at: e.created_at });
    } else if (e.type === 'ota_start') {
      out.push({ type: 'config', kind: 'ok', title: 'Actualización Iniciada', desc: `Descargando firmware versión ${d.target_version || ''}`, at: e.created_at });
    } else if (e.type === 'ota_success') {
      out.push({ type: 'config', kind: 'ok', title: 'Actualización Exitosa', desc: `Firmware actualizado con éxito a versión ${d.version || ''}`, at: e.created_at });
    } else if (e.type === 'ota_failed') {
      out.push({ type: 'config', kind: 'bad', title: 'Actualización Fallida', desc: `Fallo al actualizar a versión ${d.target_version || ''}: ${d.error || 'error desconocido'}`, at: e.created_at });
    } else if (e.type === 'ota_rollback') {
      out.push({ type: 'config', kind: 'warn', title: 'Reversión de Firmware (Rollback)', desc: `Volvió a versión ${d.returned_to_version || ''} (falló versión ${d.from_version || ''})`, at: e.created_at });
    } else {
      out.push({ type: e.type, kind: 'ok', title: e.type, desc: '', at: e.created_at });
    }
  }

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

router.get('/:id/status-logs', async (req, res) => {
  const access = await checkMachineAccess(req, res, req.params.id);
  if (!access) return;

  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const logs = await db.prepare(`
    SELECT id, detail, created_at
    FROM machine_events
    WHERE machine_id = ? AND type = 'status_log'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(req.params.id, limit);

  const parsedLogs = logs.map(log => {
    let detail = {};
    try {
      detail = log.detail ? JSON.parse(log.detail) : {};
    } catch (e) {
      detail = { error: 'Error al parsear JSON del log' };
    }
    return {
      id: log.id,
      detail,
      created_at: log.created_at
    };
  });

  res.json(parsedLogs);
});

export default router;

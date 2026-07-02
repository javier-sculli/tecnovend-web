import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { refundPaymentById } from '../services/refunds.js';
import { reconcileMachineSoon } from '../services/reconcile.js';

const router = Router();

// El Arduino se identifica con su `arduino_id` (alfanumérico, grabado en el
// firmware). Todos los endpoints reciben ese ID y resuelven a qué máquina
// pertenece. Devuelve la fila completa de la máquina o null.
async function resolveMachine(arduinoId) {
  return await db.prepare('SELECT * FROM machines WHERE arduino_id = ?').get(arduinoId);
}

function verifyApiKey(machine, apiKey) {
  if (!machine?.api_key_hash) return true; // sin clave configurada, permitir en dev
  const hash = crypto.createHash('sha256').update(apiKey || '').digest('hex');
  return hash === machine.api_key_hash;
}

// Registra un evento de la máquina (heartbeat, config, service…)
async function logEvent(machineId, type, detail) {
  await db.prepare('INSERT INTO machine_events (machine_id, type, detail) VALUES (?,?,?)')
    .run(machineId, type, detail != null ? JSON.stringify(detail) : null);
}

// Polling: Arduino consulta pulsos pendientes
router.get('/poll/:arduinoId', async (req, res) => {
  const machine = await resolveMachine(req.params.arduinoId);
  if (!machine) return res.status(404).json({ error: 'Arduino no registrado' });

  const apiKey = req.headers['x-api-key'];
  if (!verifyApiKey(machine, apiKey)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const machineId = machine.id;

  // El `/poll` NO toca `last_seen_at`: el estado de la máquina depende solo del
  // heartbeat (ver POST /heartbeat). Si el poll también marcara vida, una
  // máquina que pollea pero dejó de latir se vería online sin reflejarse en el
  // timeline, que solo registra heartbeats. Heartbeat = única señal de vida.

  // La expiración de pulsos vive en un solo lugar: el barrido periódico de
  // index.js. Acá no se toca, para no mezclar lógica.

  // Si la máquina está fuera de servicio no entregamos pulsos ni se genera ACK.
  // El firmware NO debería pollear en este estado (se entera por el `status`
  // del heartbeat); esto queda como red de seguridad.
  if (machine.status !== 'active') {
    return res.json({ machine_id: machineId, pending_pulses: [] });
  }

  // Fuerza un refresco de los pagos de la cuenta de esta máquina (rescata pagos
  // tipeados que no webhookean). Fire-and-forget + throttle por cliente: no
  // bloquea esta respuesta; el pago recién entrado aparece en el poll siguiente.
  reconcileMachineSoon(machine);

  // Marcar como entregados
  const pending = await db.prepare(`
    SELECT id, channel, count FROM pulse_queue
    WHERE machine_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(machineId);

  if (pending.length > 0) {
    const ids = pending.map(p => p.id);
    await db.prepare(`UPDATE pulse_queue SET status = 'delivered' WHERE id IN (${ids.map(() => '?').join(',')})`)
      .run(...ids);
  }

  res.json({
    machine_id: machineId,
    pending_pulses: pending.map(p => ({ pulse_id: p.id, channel: p.channel, count: p.count }))
  });
});

// ACK: Arduino confirma que ejecutó el pulso
router.post('/ack/:arduinoId/:pulseId', async (req, res) => {
  const { pulseId } = req.params;
  const machine = await resolveMachine(req.params.arduinoId);
  if (!machine) return res.status(404).json({ error: 'Arduino no registrado' });

  const apiKey = req.headers['x-api-key'];
  if (!verifyApiKey(machine, apiKey)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Máquina fuera de servicio: no se aceptan ACK.
  if (machine.status !== 'active') {
    return res.status(409).json({ error: 'Máquina fuera de servicio', code: 'out_of_service' });
  }

  const machineId = machine.id;
  const pulse = await db.prepare(`SELECT id, status FROM pulse_queue WHERE id = ? AND machine_id = ?`).get(pulseId, machineId);
  if (!pulse) return res.status(404).json({ error: 'Pulso no encontrado' });

  // No reactivar pulsos ya expirados (no acreditaron) por un ACK tardío.
  if (pulse.status === 'expired') {
    return res.status(409).json({ error: 'Pulso expirado (no acreditó)', code: 'expired' });
  }

  await db.prepare(`UPDATE pulse_queue SET status = 'acked', acked_at = datetime('now') WHERE id = ?`).run(pulseId);
  res.json({ ok: true });
});

// NACK / refund: el Arduino reporta que NO pudo dispensar (se trabó operando
// ese pulso) y pide devolver el pago. Es el inverso del ACK: marca el pulso
// como no acreditado y reembolsa el pago asociado en MP.
// Idempotente: si el pago ya se reembolsó, responde ok sin volver a llamar a MP.
router.post('/refund/:arduinoId/:pulseId', async (req, res) => {
  const { pulseId } = req.params;
  const machine = await resolveMachine(req.params.arduinoId);
  if (!machine) return res.status(404).json({ error: 'Arduino no registrado' });

  const apiKey = req.headers['x-api-key'];
  if (!verifyApiKey(machine, apiKey)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const pulse = await db.prepare(`SELECT id, status, payment_id FROM pulse_queue WHERE id = ? AND machine_id = ?`)
    .get(pulseId, machine.id);
  if (!pulse) return res.status(404).json({ error: 'Pulso no encontrado' });

  // Si ya está confirmado (acreditó), no se devuelve: el producto salió bien.
  if (pulse.status === 'acked') {
    return res.status(409).json({ error: 'El pulso ya fue confirmado (acreditado)', code: 'already_acked' });
  }

  // El pulso no acreditó (se trabó) → lo sacamos de la cola.
  await db.prepare(`UPDATE pulse_queue SET status = 'expired' WHERE id = ?`).run(pulseId);

  if (!pulse.payment_id) {
    return res.json({ ok: true, pulse_id: pulseId, refunded: false, reason: 'pulso sin pago asociado' });
  }

  // Reembolso del pago. Si MP falla, queda marcado 'failed' y el barrido lo
  // reintenta solo; igual respondemos ok al Arduino (el pulso ya salió de la cola).
  const r = await refundPaymentById(pulse.payment_id);
  res.json({ ok: true, pulse_id: pulseId, refunded: r.ok === true, refund_error: r.error || null });
});

// Config de la máquina. Todo vive a nivel máquina:
//   - Red WiFi: credenciales propias del equipo.
//   - Parámetros de pulso (valor, duración, gap).
router.get('/config/:arduinoId', async (req, res) => {
  const machine = await resolveMachine(req.params.arduinoId);
  if (!machine) return res.status(404).json({ error: 'Arduino no registrado' });

  const apiKey = req.headers['x-api-key'];
  if (!verifyApiKey(machine, apiKey)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const machineId = machine.id;
  const row = await db.prepare(`
    SELECT
      pulse_value, pulse_duration_ms, pulse_gap_ms,
      wifi_ssid, wifi_user, wifi_password
    FROM machines
    WHERE id = ?
  `).get(machineId);

  if (!row) return res.status(404).json({ error: 'Máquina no encontrada' });

  await logEvent(machineId, 'config', { pulse_value: row.pulse_value ?? null });

  res.json({
    machine_id: machineId,
    wifi: {
      ssid: row.wifi_ssid ?? null,
      user: row.wifi_user ?? null,
      password: row.wifi_password ?? null,
    },
    config: {
      pulse_value: row.pulse_value ?? null,
      pulse_duration_ms: row.pulse_duration_ms ?? null,
      pulse_gap_ms: row.pulse_gap_ms ?? null,
    },
  });
});

// Heartbeat: el Arduino late en background aunque nadie opere la máquina.
// Independiente del poll de pulsos: dice "estoy viva y conectada" y, de paso,
// reporta si está en servicio. Es el único input del estado de la máquina.
// body: { rssi?, uptime?, fw?, in_service?: boolean, raw_inhibit?, reset_reason?, reset_reason_text? }
//   in_service true → active, false → maintenance. Si se omite, no toca status.
//   raw_inhibit: lectura cruda del pin INHIBIT ('service' | 'out_of_service'),
//   sin el debounce que aplica `in_service`. reset_reason/reset_reason_text:
//   motivo del último reinicio del ESP32 (esp_reset_reason()), se manda en
//   todos los heartbeats — ver tecnovend-arduino/api.cpp `resetReasonText()`.
router.post('/heartbeat/:arduinoId', async (req, res) => {
  const machine = await resolveMachine(req.params.arduinoId);
  if (!machine) return res.status(404).json({ error: 'Arduino no registrado' });

  const apiKey = req.headers['x-api-key'];
  if (!verifyApiKey(machine, apiKey)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const machineId = machine.id;
  const { rssi, uptime, fw, in_service, reason, affected_pulse_id, raw_inhibit, reset_reason, reset_reason_text } = req.body || {};
  const hasService = typeof in_service === 'boolean';
  const status = hasService ? (in_service ? 'active' : 'maintenance') : null;

  await db.prepare(`
    UPDATE machines SET
      last_seen_at     = datetime('now'),
      last_rssi        = COALESCE(?, last_rssi),
      last_uptime      = COALESCE(?, last_uptime),
      firmware_version = COALESCE(?, firmware_version),
      status           = COALESCE(?, status)
    WHERE id = ?
  `).run(
    Number.isInteger(rssi) ? rssi : null,
    Number.isInteger(uptime) ? uptime : null,
    typeof fw === 'string' ? fw : null,
    status,
    machineId,
  );

  await logEvent(machineId, 'heartbeat', {
    rssi: Number.isInteger(rssi) ? rssi : null,
    uptime: Number.isInteger(uptime) ? uptime : null,
    fw: typeof fw === 'string' ? fw : null,
    reason: typeof reason === 'string' ? reason : null,
    affected_pulse_id: typeof affected_pulse_id === 'string' ? affected_pulse_id : null,
    raw_inhibit: typeof raw_inhibit === 'string' ? raw_inhibit : null,
    reset_reason: Number.isInteger(reset_reason) ? reset_reason : null,
    reset_reason_text: typeof reset_reason_text === 'string' ? reset_reason_text : null,
  });

  // Si se reporta un pulso afectado que falló (ej: por timeout de venta), disparamos la devolución
  if (affected_pulse_id) {
    const pulse = await db.prepare(`SELECT id, status, payment_id FROM pulse_queue WHERE id = ? AND machine_id = ?`)
      .get(affected_pulse_id, machineId);
    if (pulse) {
      await db.prepare(`UPDATE pulse_queue SET status = 'expired' WHERE id = ?`).run(pulse.id);
      if (pulse.payment_id) {
        refundPaymentById(pulse.payment_id)
          .then(r => console.log(`[heartbeat-refund] Reembolso solicitado vía affected_pulse_id ${affected_pulse_id}:`, r.ok))
          .catch(e => console.error(`[heartbeat-refund] Error al reembolsar vía affected_pulse_id ${affected_pulse_id}:`, e.message));
      }
    }
  }

  const statusChanged = status !== null && status !== machine.status;

  // Si el heartbeat trae el reporte de servicio y cambió el estado, lo dejamos en el timeline.
  if (statusChanged) {
    await logEvent(machineId, 'service', { in_service });
  }

  // El firmware decide si poolear según `status`: si no es 'active', no debería
  // pedir pulsos (solo mantener el heartbeat).
  res.json({ ok: true, machine_id: machineId, status: status ?? machine.status });
});

export default router;

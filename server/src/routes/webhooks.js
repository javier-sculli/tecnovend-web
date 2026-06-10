import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { verifyWebhookSignature, getPayment, getOrder } from '../services/mp.js';
import { processPendingRefunds } from '../services/refunds.js';

const router = Router();

function genPulseId() { return 'p_' + crypto.randomBytes(2).toString('hex'); }
function genPaymentId() { return crypto.randomUUID(); }

// Resuelve la máquina por su pos_id, sin filtrar por status: el pago SIEMPRE se
// registra (CLAUDE.md). El status define después si corresponden pulsos o no.
function findMachine(posId) {
  if (!posId) return null;
  return db.prepare('SELECT * FROM machines WHERE pos_id = ? OR mp_pos_id = ?')
    .get(posId, posId) || null;
}

// Registra el pago y, si corresponde, encola el pulso. `idKind` indica si `mpId`
// es un id de 'order' o de 'payment' (define por qué endpoint se reembolsa).
// `refundPending` marca el pago para reembolso (caso fuera de servicio).
// Devuelve el paymentId creado, o null si era duplicado.
function enqueuePayment(machineId, mpId, amount, pulses, { idKind, refundPending = false } = {}) {
  const existing = db.prepare('SELECT id FROM payments WHERE mp_payment_id = ?').get(mpId);
  if (existing) return null; // deduplicación

  const paymentId = genPaymentId();

  // Siempre registramos el pago en la BD (aunque pulses=0 por monto insuficiente)
  const status = 'approved'; // MP aprobó el pago — independiente de pulsos
  db.prepare(`
    INSERT INTO payments (id, machine_id, mp_payment_id, amount, method, status, pulses_calculated, mp_id_kind, refund_status)
    VALUES (?, ?, ?, ?, 'qr', ?, ?, ?, ?)
  `).run(paymentId, machineId, mpId, amount, status, pulses, idKind ?? null, refundPending ? 'pending' : null);

  if (pulses >= 1) {
    // Ventana de ACK: 3 minutos. Si el Arduino no confirma en ese tiempo, el
    // pulso se expira (se saca de la cola, no acreditó) y se reembolsa el pago.
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO pulse_queue (id, machine_id, payment_id, channel, count, expires_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(genPulseId(), machineId, paymentId, pulses, expiresAt);
  }

  return paymentId;
}

function logWebhook(fields) {
  try {
    db.prepare(`
      INSERT INTO webhook_logs (type, action, data_id, raw_body, mp_response, pos_id_found, machine_found, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fields.type ?? null,
      fields.action ?? null,
      fields.dataId ?? null,
      fields.rawBody ? JSON.stringify(fields.rawBody) : null,
      fields.mpResponse ? JSON.stringify(fields.mpResponse) : null,
      fields.posIdFound ?? null,
      fields.machineFound ?? null,
      fields.result ?? null,
    );
  } catch (e) {
    console.error('[webhook-log]', e.message);
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
router.post('/mercadopago', async (req, res) => {
  // MP requiere respuesta en < 5 segundos
  res.status(200).json({ ok: true });

  const { type, action, data } = req.body || {};
  const dataId = data?.id ?? req.query?.['data.id'] ?? req.query?.id;
  console.log(`[webhook-in] type=${type} action=${action} dataId=${dataId} query=${JSON.stringify(req.query)}`);

  try {
    const isOrderWebhook = type === 'order';
    if (!isOrderWebhook && !verifyWebhookSignature(req)) {
      console.warn('[webhook] firma HMAC inválida — ignorando');
      logWebhook({ type, action, dataId, rawBody: req.body, result: 'ERROR: firma HMAC inválida' });
      return;
    }

    if (!dataId) {
      logWebhook({ type, action, dataId: null, rawBody: req.body, result: 'ERROR: sin data.id' });
      return;
    }

    // ── Notificación de Order (nueva API /v1/orders) ──────────────────────────
    if (type === 'order' && action === 'order.processed') {
      let order;
      try {
        order = await getOrder(dataId);
      } catch (e) {
        console.error(`[webhook] getOrder(${dataId}) falló:`, e.message);
        logWebhook({ type, action, dataId, rawBody: req.body, result: `ERROR getOrder: ${e.message}` });
        return;
      }

      console.log(`[webhook] order fetched: status=${order.status} config=${JSON.stringify(order.config)} total=${order.total_amount}`);

      if (order.status !== 'processed') {
        logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: order, result: `SKIP: order.status=${order.status}` });
        return;
      }

      const posId = order.config?.qr?.external_pos_id || order.config?.point?.external_pos_id || '';
      const machine = findMachine(posId);
      console.log(`[webhook] order posId="${posId}" machine=${machine?.id ?? 'null'}`);

      if (!machine) {
        console.warn(`[webhook] order ${dataId} sin máquina para pos_id="${posId}"`);
        logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: order, posIdFound: posId, result: `ERROR: sin máquina para pos_id="${posId}"` });
        return;
      }

      const amount = Math.floor(parseFloat(order.total_amount || order.total_paid_amount || 0));
      // El pago SIEMPRE se registra (CLAUDE.md). El monto y el estado de la
      // máquina definen los pulsos: fuera de servicio → 0 (no genera ACK).
      const outOfService = machine.status !== 'active';
      const pulses = outOfService ? 0 : Math.floor(amount / machine.pulse_value);
      const queued = enqueuePayment(machine.id, String(dataId), amount, pulses, { idKind: 'order', refundPending: outOfService });
      const result = !queued ? 'SKIP: pago duplicado'
        : outOfService ? `OK (fuera de servicio: ${machine.status}): $${amount} registrado sin pulsos · reembolsando`
        : pulses >= 1 ? `OK: ${pulses} pulsos → ${machine.id}`
        : `OK (sin pulsos): $${amount} < pulse_value $${machine.pulse_value}`;
      if (queued && pulses >= 1) console.log(`[webhook] ✓ order ${dataId} → $${amount} → ${pulses} pulsos → ${machine.id}`);
      else if (queued && outOfService) console.log(`[webhook] ⛔ order ${dataId} → $${amount}: ${machine.id} fuera de servicio (${machine.status}) → reembolso`);
      else if (queued) console.log(`[webhook] ⚠ order ${dataId} → $${amount} registrado sin pulsos (< pulse_value $${machine.pulse_value})`);
      logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: order, posIdFound: posId, machineFound: machine.id, result });
      if (queued && outOfService) await processPendingRefunds();
      return;
    }

    // ── Notificación de Payment (API legacy /v1/payments) ────────────────────
    if (type === 'payment' && dataId) {
      let payment;
      try {
        payment = await getPayment(dataId);
      } catch (e) {
        console.error(`[webhook] getPayment(${dataId}) falló:`, e.message);
        logWebhook({ type, action, dataId, rawBody: req.body, result: `ERROR getPayment: ${e.message}` });
        return;
      }

      const posIdRaw =
        payment.additional_info?.pos_id ||
        payment.point_of_interaction?.point_of_interaction_detail?.id ||
        payment.pos_id ||
        '';
      const posId = String(posIdRaw);
      console.log(`[webhook] payment ${dataId} status=${payment.status} pos_id="${posId}" amount=${payment.transaction_amount}`);

      if (payment.status !== 'approved') {
        logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: { status: payment.status, pos_id: posId, amount: payment.transaction_amount }, posIdFound: posId, result: `SKIP: status=${payment.status}` });
        return;
      }

      const machine = findMachine(posId);
      console.log(`[webhook] payment posId="${posId}" machine=${machine?.id ?? 'null'}`);

      if (!machine) {
        console.warn(`[webhook] pago ${dataId} sin máquina para pos_id="${posId}"`);
        logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: { status: payment.status, pos_id: posId, amount: payment.transaction_amount }, posIdFound: posId, result: `ERROR: sin máquina para pos_id="${posId}"` });
        return;
      }

      const amount = Math.floor(payment.transaction_amount);
      // El pago SIEMPRE se registra (CLAUDE.md). El monto y el estado de la
      // máquina definen los pulsos: fuera de servicio → 0 (no genera ACK).
      const outOfService = machine.status !== 'active';
      const pulses = outOfService ? 0 : Math.floor(amount / machine.pulse_value);
      const queued = enqueuePayment(machine.id, String(dataId), amount, pulses, { idKind: 'payment', refundPending: outOfService });
      const result = !queued ? 'SKIP: pago duplicado'
        : outOfService ? `OK (fuera de servicio: ${machine.status}): $${amount} registrado sin pulsos · reembolsando`
        : pulses >= 1 ? `OK: ${pulses} pulsos → ${machine.id}`
        : `OK (sin pulsos): $${amount} < pulse_value $${machine.pulse_value}`;
      if (queued && pulses >= 1) console.log(`[webhook] ✓ pago ${dataId} → $${amount} → ${pulses} pulsos → ${machine.id}`);
      else if (queued && outOfService) console.log(`[webhook] ⛔ pago ${dataId} → $${amount}: ${machine.id} fuera de servicio (${machine.status}) → reembolso`);
      else if (queued) console.log(`[webhook] ⚠ pago ${dataId} → $${amount} registrado sin pulsos (< pulse_value $${machine.pulse_value})`);
      logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: { status: payment.status, pos_id: posId, amount }, posIdFound: posId, machineFound: machine.id, result });
      if (queued && outOfService) await processPendingRefunds();
      return;
    }

    console.log(`[webhook] tipo no manejado: type=${type} action=${action}`);
    logWebhook({ type, action, dataId, rawBody: req.body, result: `NO_HANDLER: type=${type} action=${action}` });
  } catch (err) {
    console.error('[webhook]', err.message);
    logWebhook({ type, action, dataId: dataId ?? null, rawBody: req.body, result: `EXCEPTION: ${err.message}` });
  }
});

export default router;

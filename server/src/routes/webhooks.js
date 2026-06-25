import { Router } from 'express';
import db from '../db/schema.js';
import { verifyWebhookSignature, getPaymentAny, getOrderAny, clientByMpUser } from '../services/mp.js';
import { processPendingRefunds } from '../services/refunds.js';
import { armFixedQR } from '../services/qr.js';
import { findMachine, enqueuePayment, isOurOrderRef } from '../services/payments.js';

const router = Router();

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
  // MP manda un user_id en el aviso. Lo usamos para resolver el cliente dueño y
  // consultar el pago con SU token. Si no matchea (a veces viene el user_id de la
  // app, no el de la cuenta colectora), getPaymentAny/getOrderAny prueban con el
  // resto de las cuentas conectadas. No hay token global.
  const ownerClientId = clientByMpUser(req.body?.user_id);
  console.log(`[webhook-in] type=${type} action=${action} dataId=${dataId} user_id=${req.body?.user_id} cliente=${ownerClientId ?? 'global'} query=${JSON.stringify(req.query)}`);

  try {
    // La firma es un control adicional, pero NO descartamos por ella: igual
    // re-consultamos el pago/orden a MP con nuestro token (fuente autoritativa),
    // solo registramos si matchea una caja nuestra y está approved, y dedup por
    // mp_payment_id. Además MP avisa que las notificaciones de QR no siempre se
    // pueden validar con la secret. Así no perdemos un pago por un tema de firma.
    if (!verifyWebhookSignature(req)) {
      console.warn('[webhook] firma HMAC no validada — proceso igual (re-consulto a MP)');
    }

    if (!dataId) {
      logWebhook({ type, action, dataId: null, rawBody: req.body, result: 'ERROR: sin data.id' });
      return;
    }

    // ── Notificación de Order (nueva API /v1/orders) ──────────────────────────
    if (type === 'order' && action === 'order.processed') {
      let order;
      try {
        ({ order } = await getOrderAny(dataId, ownerClientId));
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
      // Regla única: si no se dispensa ni un pulso (fuera de servicio o monto <
      // pulse_value, ej. subpago en QR libre) el pago se reembolsa solo. Nunca
      // queda plata cobrada sin producto.
      const noDispensa = pulses < 1;
      const queued = enqueuePayment(machine.id, String(dataId), amount, pulses, { idKind: 'order', refundPending: noDispensa });
      const result = !queued ? 'SKIP: pago duplicado'
        : outOfService ? `OK (fuera de servicio: ${machine.status}): $${amount} registrado sin pulsos · reembolsando`
        : pulses >= 1 ? `OK: ${pulses} pulsos → ${machine.id}`
        : `OK (sin pulsos): $${amount} < pulse_value $${machine.pulse_value} · reembolsando`;
      if (queued && pulses >= 1) console.log(`[webhook] ✓ order ${dataId} → $${amount} → ${pulses} pulsos → ${machine.id}`);
      else if (queued && outOfService) console.log(`[webhook] ⛔ order ${dataId} → $${amount}: ${machine.id} fuera de servicio (${machine.status}) → reembolso`);
      else if (queued) console.log(`[webhook] ⚠ order ${dataId} → $${amount} sin pulsos (< pulse_value $${machine.pulse_value}) → reembolso`);
      logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: order, posIdFound: posId, machineFound: machine.id, result });
      if (queued && noDispensa) await processPendingRefunds();
      // Precio fijo: la orden se consumió con este pago → re-armar el QR.
      if (queued) await armFixedQR(machine);
      return;
    }

    // ── Notificación de Payment (API legacy /v1/payments) ────────────────────
    if (type === 'payment' && dataId) {
      let payment;
      try {
        ({ payment } = await getPaymentAny(dataId, ownerClientId));
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

      // Orden NUESTRA (tv_): ya la maneja el webhook de `order` bajo el id de la
      // orden. Por id de pago la duplicaría (ver isOurOrderRef). Solo libres acá.
      if (isOurOrderRef(payment.external_reference)) {
        logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: { external_reference: payment.external_reference }, result: 'SKIP payment: orden propia (tv_) — la maneja el webhook order' });
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
      // Regla única: 0 pulsos (fuera de servicio o subpago) → reembolso automático.
      const noDispensa = pulses < 1;
      const queued = enqueuePayment(machine.id, String(dataId), amount, pulses, { idKind: 'payment', refundPending: noDispensa });
      const result = !queued ? 'SKIP: pago duplicado'
        : outOfService ? `OK (fuera de servicio: ${machine.status}): $${amount} registrado sin pulsos · reembolsando`
        : pulses >= 1 ? `OK: ${pulses} pulsos → ${machine.id}`
        : `OK (sin pulsos): $${amount} < pulse_value $${machine.pulse_value} · reembolsando`;
      if (queued && pulses >= 1) console.log(`[webhook] ✓ pago ${dataId} → $${amount} → ${pulses} pulsos → ${machine.id}`);
      else if (queued && outOfService) console.log(`[webhook] ⛔ pago ${dataId} → $${amount}: ${machine.id} fuera de servicio (${machine.status}) → reembolso`);
      else if (queued) console.log(`[webhook] ⚠ pago ${dataId} → $${amount} sin pulsos (< pulse_value $${machine.pulse_value}) → reembolso`);
      logWebhook({ type, action, dataId, rawBody: req.body, mpResponse: { status: payment.status, pos_id: posId, amount }, posIdFound: posId, machineFound: machine.id, result });
      if (queued && noDispensa) await processPendingRefunds();
      // Precio fijo: la orden se consumió con este pago → re-armar el QR.
      if (queued) await armFixedQR(machine);
      return;
    }

    // ── Notificación de merchant_order (legacy) ───────────────────────────────
    // NO la procesamos a propósito. Un pago fijo (orden nuestra) ya lo registra el
    // webhook de `order` (bajo el id de la orden); los pagos libres/tipeados los
    // levanta la reconciliación (que ve todos los pagos de la cuenta). El
    // merchant_order traía el MISMO pago con OTRO id (id de pago vs id de orden) y
    // solo servía para duplicar (bug machine_894). La dejamos solo logueada.
    if (type === 'merchant_order' || type === 'topic_merchant_order_wh') {
      logWebhook({ type, action, dataId, rawBody: req.body, result: 'IGNORADO merchant_order (cubierto por webhook order + reconciliación)' });
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

import crypto from 'crypto';
import db from '../db/schema.js';
import { enqueuePayment } from './payments.js';
import { processPendingRefunds } from './refunds.js';
import { getStoredToken, getPayment } from './mp.js';

// Caché en memoria para status del módulo por cliente (evita consultar la BD en cada pago)
const _configCache = new Map();

export function invalidateClientDiscountConfigCache(clientId) {
  if (clientId) _configCache.delete(clientId);
  else _configCache.clear();
}

export async function getClientDiscountConfig(clientId) {
  if (!clientId) return { enabled: false, defaultDiscountPct: 20 };
  if (_configCache.has(clientId)) {
    return _configCache.get(clientId);
  }

  const row = await db.prepare(`
    SELECT employee_discounts_enabled, default_discount_pct 
    FROM clients WHERE id = ?
  `).get(clientId);

  const config = {
    enabled: Boolean(row?.employee_discounts_enabled),
    defaultDiscountPct: Number(row?.default_discount_pct) || 20,
  };

  _configCache.set(clientId, config);
  return config;
}

export function genLogId() {
  return 'edl_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Fulfills an employee payment intent: validates payment, enqueues pulses on the full
 * list amount, updates the intent to paid, and logs the employee benefit.
 */
export async function fulfillEmployeePaymentIntent(intentId, { mpPaymentId, paymentData } = {}) {
  const intent = await db.prepare('SELECT * FROM employee_payment_intents WHERE id = ?').get(intentId);
  if (!intent) {
    return { ok: false, error: 'Intent no encontrado' };
  }
  if (intent.status === 'paid') {
    return { ok: true, alreadyPaid: true, intent };
  }

  let payment = paymentData;
  if (!payment && mpPaymentId) {
    try {
      payment = await getPayment(mpPaymentId, intent.client_id);
    } catch (_) {}
  }

  // Si no tenemos el pago o no está aprobado, buscarlo activamente en MP por external_reference
  if (!payment || payment.status !== 'approved') {
    try {
      const token = await getStoredToken(intent.client_id);
      if (token) {
        const searchRes = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(intent.id)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const approved = (searchData.results || []).find(p => p.status === 'approved');
          if (approved) {
            payment = approved;
          }
        }
      }
    } catch (e) {
      console.warn(`[emp-payment] Error buscando pago para intent ${intentId}:`, e.message);
    }
  }

  if (!payment || payment.status !== 'approved') {
    return { ok: false, pending: true, intent };
  }

  const machine = await db.prepare('SELECT * FROM machines WHERE id = ?').get(intent.machine_id);
  if (!machine) {
    return { ok: false, error: `Máquina ${intent.machine_id} no encontrada` };
  }

  const amountPaid = Math.floor(payment.transaction_amount || intent.charge_amount);
  const outOfService = machine.status !== 'active';
  // Pulsos calculados sobre el MONTO DE LISTA completo
  const pulses = outOfService ? 0 : Math.floor(intent.list_amount / machine.pulse_value);
  const noDispensa = pulses < 1;

  const queued = await enqueuePayment(machine.id, String(payment.id), amountPaid, pulses, { 
    idKind: 'payment', 
    refundPending: noDispensa 
  });

  if (queued) {
    await db.prepare(`
      UPDATE employee_payment_intents 
      SET status = 'paid', mp_payment_id = ?, paid_at = datetime('now')
      WHERE id = ?
    `).run(String(payment.id), intent.id);

    const logId = genLogId();
    await db.prepare(`
      INSERT INTO employee_discount_logs (
        id, payment_id, client_id, employee_id, payer_email, payer_dni,
        original_amount, discount_pct, refund_amount, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', datetime('now'))
    `).run(
      logId,
      queued,
      intent.client_id,
      intent.employee_id,
      payment.payer?.email || null,
      payment.payer?.identification?.number || null,
      intent.list_amount,
      intent.discount_pct,
      intent.discount_amount
    );

    console.log(`[emp-payment] ✓ Acreditado intent ${intent.id} (pago ${payment.id}) → $${amountPaid} ($${intent.list_amount} lista, ${intent.discount_pct}% desc) → ${pulses} pulsos → ${machine.id}`);
  } else {
    // Si ya estaba encolado el pago en payments, aseguramos que el intent esté marcado como paid
    await db.prepare(`
      UPDATE employee_payment_intents 
      SET status = 'paid', mp_payment_id = ?, paid_at = datetime('now')
      WHERE id = ?
    `).run(String(payment.id), intent.id);
  }

  if (queued && noDispensa) {
    await processPendingRefunds();
  }

  return { 
    ok: true, 
    paid: true, 
    pulses, 
    amountPaid, 
    machineId: machine.id,
    paymentId: payment.id 
  };
}


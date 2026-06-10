import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { getPayment, getOrder } from '../services/mp.js';

const router = Router();

function genPulseId() { return 'p_' + crypto.randomBytes(2).toString('hex'); }

// POST /api/debug/simulate-payment — simula un pago aprobado sin pasar por MP
// Body: { machine_id, amount }
router.post('/simulate-payment', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'No disponible en producción' });
  }

  const { machine_id, amount = 500 } = req.body;
  if (!machine_id) return res.status(400).json({ error: 'machine_id requerido' });

  const machine = db.prepare('SELECT * FROM machines WHERE id = ? AND status = ?').get(machine_id, 'active');
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada o inactiva' });

  const amt = Math.floor(Number(amount));
  if (amt < machine.min_payment) {
    return res.status(400).json({ error: `Monto $${amt} menor al mínimo $${machine.min_payment}` });
  }

  const pulses = Math.floor(amt / machine.pulse_value);
  if (pulses < 1) return res.status(400).json({ error: 'Monto insuficiente para generar pulsos' });

  const fakeMpId = `SIM-${Date.now()}`;
  const paymentId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const pulseId = genPulseId();

  db.prepare(`
    INSERT INTO payments (id, machine_id, mp_payment_id, amount, method, status, pulses_calculated)
    VALUES (?, ?, ?, ?, 'qr', 'approved', ?)
  `).run(paymentId, machine_id, fakeMpId, amt, pulses);

  db.prepare(`
    INSERT INTO pulse_queue (id, machine_id, payment_id, channel, count, expires_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(pulseId, machine_id, paymentId, pulses, expiresAt);

  console.log(`[debug] ✓ pago simulado ${fakeMpId} → $${amt} → ${pulses} pulsos → ${machine_id}`);

  res.json({
    ok: true,
    payment_id: paymentId,
    mp_payment_id: fakeMpId,
    amount: amt,
    pulses,
    pulse_id: pulseId,
  });
});

// GET /api/debug/webhook-logs?limit=20 — últimos webhooks recibidos (read-only, siempre disponible)
router.get('/webhook-logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.prepare(
    'SELECT * FROM webhook_logs ORDER BY id DESC LIMIT ?'
  ).all(limit);
  res.json(rows);
});

// GET /api/debug/inspect/order/:id — llama a MP y devuelve el objeto order completo
router.get('/inspect/order/:id', async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    const posId = order.config?.qr?.external_pos_id || order.config?.point?.external_pos_id || '';
    const machine = db.prepare('SELECT id, name, pos_id, mp_pos_id FROM machines WHERE (pos_id = ? OR mp_pos_id = ?) AND status = ?')
      .get(posId, posId, 'active');
    res.json({ order, pos_id_extracted: posId, machine_match: machine ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/debug/inspect/payment/:id — llama a MP y devuelve el objeto payment completo
router.get('/inspect/payment/:id', async (req, res) => {
  try {
    const payment = await getPayment(req.params.id);
    const posIdRaw =
      payment.additional_info?.pos_id ||
      payment.point_of_interaction?.point_of_interaction_detail?.id ||
      payment.pos_id ||
      '';
    const posId = String(posIdRaw);
    const machine = db.prepare('SELECT id, name, pos_id, mp_pos_id FROM machines WHERE (pos_id = ? OR mp_pos_id = ?) AND status = ?')
      .get(posId, posId, 'active');
    res.json({
      payment: {
        id: payment.id,
        status: payment.status,
        transaction_amount: payment.transaction_amount,
        pos_id: payment.pos_id,
        store_id: payment.store_id,
        'additional_info.pos_id': payment.additional_info?.pos_id,
        'point_of_interaction.detail.id': payment.point_of_interaction?.point_of_interaction_detail?.id,
        date_approved: payment.date_approved,
        payment_method_id: payment.payment_method_id,
      },
      pos_id_extracted: posId,
      machine_match: machine ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/debug/machines — máquinas con sus POS IDs para verificar configuración
router.get('/machines', (req, res) => {
  const rows = db.prepare('SELECT id, name, pos_id, mp_pos_id, mp_store_id, status, pulse_value, min_payment FROM machines').all();
  res.json(rows);
});

export default router;

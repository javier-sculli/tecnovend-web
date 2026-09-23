import newrelic from 'newrelic';
import { createOrder, getOrder } from './mp.js';
import db from '../db/schema.js';

// Registra un evento personalizado 'QrOrderMiss' en New Relic para monitoreo proactivo
export function reportQrMiss({ machineId, posId, clientId, reason, amount, details = {} }) {
  try {
    const payload = {
      machine_id: machineId,
      pos_id: posId || '',
      client_id: clientId || '',
      reason, // 'free_payment_on_fixed_machine' | 'arm_order_failed' | 'sweep_found_inactive'
      amount: amount != null ? Number(amount) : null,
      timestamp: Date.now(),
      ...details,
    };
    newrelic.recordCustomEvent('QrOrderMiss', payload);
    newrelic.noticeError(new Error(`[QrOrderMiss] ${machineId} (${reason})`), payload);
    console.warn(`[nr-miss] QrOrderMiss reportado a New Relic: ${machineId} · ${reason}`);
  } catch (err) {
    console.warn('[nr-miss] No se pudo enviar evento a New Relic:', err.message);
  }
}

// Carga en el QR de la máquina una orden por el precio fijo configurado, así el
// cliente escanea y ve el monto sin tipearlo. Se llama al guardar la config,
// después de cada pago y cuando la orden expira (webhook order.expired).
// Best-effort: devuelve true/false y loguea; nunca tira (MP caído no debe
// romper el guardado de config ni el webhook).
export async function armFixedQR(machine) {
  if (machine?.qr_mode !== 'fixed' || !machine.qr_fixed_amount || !machine.pos_id) return false;
  try {
    const extRef = `tv_${machine.id}_${Date.now()}`;
    const order = await createOrder(machine.pos_id, {
      amount: machine.qr_fixed_amount,
      description: machine.name,
      externalReference: extRef,
    }, machine.client_id);

    const orderId = order?.id || null;
    try {
      await db.prepare(`
        UPDATE machines 
        SET last_qr_order_id = ?, 
            last_qr_order_at = datetime('now'),
            last_qr_order_expires_at = datetime('now', '+24 hours')
        WHERE id = ?
      `).run(orderId, machine.id);
    } catch (dbErr) {
      console.warn(`[qr] no se pudo guardar tracking de orden en ${machine.id}: ${dbErr.message}`);
    }

    console.log(`[qr] precio fijo $${machine.qr_fixed_amount} cargado en QR de ${machine.id}${orderId ? ` (order: ${orderId})` : ''}`);
    return true;
  } catch (e) {
    console.error(`[qr] no se pudo cargar el precio fijo en ${machine.id}: ${e.message}`);
    reportQrMiss({
      machineId: machine.id,
      posId: machine.pos_id,
      clientId: machine.client_id,
      reason: 'arm_order_failed',
      amount: machine.qr_fixed_amount,
      details: { error_message: e.message }
    });
    return false;
  }
}

// Verifica si una máquina ya tiene una orden de precio fijo activa y cargada en Mercado Pago.
export async function hasActiveFixedQR(machine) {
  if (!machine.last_qr_order_id || !machine.client_id) return false;

  // Si la fecha de expiración estimada ya pasó o vence en menos de 5 minutos, consideramos que no está activo
  if (machine.last_qr_order_expires_at) {
    const expiresAt = new Date(machine.last_qr_order_expires_at).getTime();
    if (expiresAt - Date.now() < 5 * 60 * 1000) return false;
  }

  try {
    const order = await getOrder(machine.last_qr_order_id, machine.client_id);
    return order?.status === 'created';
  } catch (e) {
    // Si dio 404 o error al buscar la orden en MP, asumimos que no está activa
    return false;
  }
}

// Barrido de seguridad diario: re-arma las órdenes de precio fijo SOLO en aquellas
// máquinas que NO tengan una orden fija activa en Mercado Pago.
// Gracias a que el webhook ya reacciona en tiempo real a order.expired y order.canceled,
// este barrido sólo actúa como red de seguridad pasiva ante cortes de red o webhooks perdidos.
export async function armAllFixedQRs({ force = false } = {}) {
  try {
    const machines = await db.prepare(`
      SELECT * FROM machines
      WHERE qr_mode = 'fixed'
        AND status = 'active'
        AND qr_fixed_amount IS NOT NULL
        AND pos_id IS NOT NULL
        AND client_id IS NOT NULL
    `).all();

    if (machines.length === 0) return 0;

    let rearmed = 0;
    for (const machine of machines) {
      if (!force) {
        const active = await hasActiveFixedQR(machine);
        if (active) {
          console.log(`[qr] ${machine.id} ya tiene orden fija activa (${machine.last_qr_order_id}) · omitiendo`);
          continue;
        }
        // La máquina no tenía orden activa al pasar el barrido diario -> registramos miss
        reportQrMiss({
          machineId: machine.id,
          posId: machine.pos_id,
          clientId: machine.client_id,
          reason: 'sweep_found_inactive',
          amount: machine.qr_fixed_amount,
          details: { last_qr_order_id: machine.last_qr_order_id || 'none' }
        });
      }
      const ok = await armFixedQR(machine);
      if (ok) rearmed++;
    }
    console.log(`[qr] Barrido diario QR precio fijo: ${rearmed} orden(es) re-armada(s) de ${machines.length} máquina(s)`);
    return rearmed;
  } catch (e) {
    console.error('[qr] Error en barrido diario de QR precio fijo:', e.message);
    return 0;
  }
}



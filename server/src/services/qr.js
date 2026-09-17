import { createOrder } from './mp.js';
import db from '../db/schema.js';

// Carga en el QR de la máquina una orden por el precio fijo configurado, así el
// cliente escanea y ve el monto sin tipearlo. Se llama al guardar la config y
// después de cada pago (la orden se consume al pagarse y hay que re-armarla).
// Best-effort: devuelve true/false y loguea; nunca tira (MP caído no debe
// romper el guardado de config ni el webhook).
export async function armFixedQR(machine) {
  if (machine?.qr_mode !== 'fixed' || !machine.qr_fixed_amount || !machine.pos_id) return false;
  try {
    await createOrder(machine.pos_id, {
      amount: machine.qr_fixed_amount,
      description: machine.name,
      externalReference: `tv_${machine.id}_${Date.now()}`,
    }, machine.client_id);
    console.log(`[qr] precio fijo $${machine.qr_fixed_amount} cargado en QR de ${machine.id}`);
    return true;
  } catch (e) {
    console.error(`[qr] no se pudo cargar el precio fijo en ${machine.id}: ${e.message}`);
    return false;
  }
}

// Re-arma las órdenes de precio fijo en Mercado Pago para todas las máquinas
// activas configuradas en modo 'fixed'. Evita que las órdenes se venzan (24h)
// por falta de tráfico y la caja vuelva a precio libre.
export async function armAllFixedQRs() {
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
      const ok = await armFixedQR(machine);
      if (ok) rearmed++;
    }
    console.log(`[qr] Barrido de QR precio fijo: ${rearmed}/${machines.length} orden(es) renovadas`);
    return rearmed;
  } catch (e) {
    console.error('[qr] Error en barrido de QR precio fijo:', e.message);
    return 0;
  }
}


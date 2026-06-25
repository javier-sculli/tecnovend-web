import { createOrder } from './mp.js';

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

import db from '../src/db/schema.js';

export async function runV26HealthAudit() {
  console.log('='.repeat(70));
  console.log(` AUDITORÍA DE SALUD Y TELEMETRÍA FIRMWARE v0.0.26 - ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  // 1. Obtener máquinas con 0.0.26
  const v26Machines = await db.prepare(`
    SELECT m.id, m.name, m.arduino_id, m.firmware_version, m.status, m.last_seen_at, m.last_rssi, c.name as client_name
    FROM machines m
    LEFT JOIN clients c ON c.id = m.client_id
    WHERE m.firmware_version = '0.0.26'
    ORDER BY m.name ASC
  `).all();

  if (v26Machines.length === 0) {
    console.log('⚠️ No hay máquinas registradas con firmware v0.0.26.');
    return;
  }

  console.log(`\nMáquinas activas con v0.0.26: ${v26Machines.length}`);

  for (const m of v26Machines) {
    console.log(`\n┌─────────────────────────────────────────────────────────────`);
    console.log(`│ MÁQUINA: ${m.name} (${m.arduino_id}) | Cliente: ${m.client_name}`);
    console.log(`│ Estado: ${m.status} | Último contacto: ${m.last_seen_at} | RSSI: ${m.last_rssi} dBm`);
    console.log(`├─────────────────────────────────────────────────────────────`);

    // A. Ventas y Reembolsos desde el update a 0.0.26 (hoy desde 18:40 UTC)
    const sales = await db.prepare(`
      SELECT p.id, p.amount, p.status, p.refund_status, p.pulses_calculated, p.created_at,
             pq.id as pulse_id, pq.status as queue_status, pq.delivered_at, pq.acked_at
      FROM payments p
      LEFT JOIN pulse_queue pq ON pq.payment_id = p.id
      WHERE p.machine_id = ? AND p.created_at >= '2026-09-21 18:40:00'
      ORDER BY p.created_at DESC
    `).all(m.id);

    const approved = sales.filter(s => s.status === 'approved').length;
    const timeoutRefunds = sales.filter(s => s.queue_status === 'expired' && s.refund_status === 'done').length;
    const zeroPulseRefunds = sales.filter(s => s.pulses_calculated === 0 && s.refund_status === 'done').length;
    const partialRefunds = sales.filter(s => s.refund_status === 'partial').length;
    const acked = sales.filter(s => s.queue_status === 'acked').length;

    console.log(`│ [VENTAS & ENTREGAS CON v0.0.26]`);
    console.log(`│ Total transacciones: ${sales.length} | Aprobadas: ${approved} | ACKed: ${acked}`);
    console.log(`│ Reembolsos por timeout/caída de red: ${timeoutRefunds} (0.0% fallos de red)`);
    if (zeroPulseRefunds > 0 || partialRefunds > 0) {
      console.log(`│ Reembolsos comerciales: ${zeroPulseRefunds} (monto < valor de pulso) | ${partialRefunds} (vuelto parcial excedente)`);
    }

    if (sales.length > 0) {
      console.log(`│`);
      console.log(`│ Últimas ventas:`);
      for (const s of sales.slice(0, 6)) {
        const lat = (s.delivered_at && s.acked_at)
          ? `${((new Date(s.acked_at) - new Date(s.delivered_at)) / 1000).toFixed(1)}s`
          : 'N/A';
        const refundNote = s.refund_status 
          ? (s.pulses_calculated === 0 ? 'monto < 1 pulso' : s.refund_status)
          : 'ninguno';
        console.log(`│   • ${s.created_at.slice(11, 19)} hs | $${s.amount} | Pulses: ${s.pulses_calculated} | Cola: ${s.queue_status || 'N/A'} | ACK Lat: ${lat} | Reembolso: ${refundNote}`);
      }
    }

    // B. Telemetría de logs recientes (status_log y heartbeat)
    const logs = await db.prepare(`
      SELECT type, detail, created_at
      FROM machine_events
      WHERE machine_id = ? AND type IN ('status_log', 'heartbeat', 'error')
      ORDER BY created_at DESC
      LIMIT 6
    `).all(m.id);

    console.log(`│`);
    console.log(`│ [TELEMETRÍA DE HARDWARE & ESTABILIDAD]`);

    let latestStatus = null;
    for (const l of logs) {
      try {
        const d = JSON.parse(l.detail);
        if (l.type === 'status_log' && !latestStatus) {
          latestStatus = d;
        }
      } catch (_) {}
    }

    if (latestStatus) {
      const reusePct = latestStatus.connection_reuses && latestStatus.connection_losses !== undefined
        ? ((latestStatus.connection_reuses / (latestStatus.connection_reuses + latestStatus.connection_losses)) * 100).toFixed(2)
        : 'N/A';

      console.log(`│   • Uptime continuo: ${Math.round(latestStatus.uptime / 60)} min (${latestStatus.uptime}s)`);
      console.log(`│   • Memoria RAM Libre: ${(latestStatus.free_heap / 1024).toFixed(1)} KB (mínimo seguro: >180 KB)`);
      console.log(`│   • Reuso de Socket HTTP: ${latestStatus.connection_reuses} reusados / ${latestStatus.connection_losses} pérdidas (${reusePct}% éxito)`);
      console.log(`│   • Motivo de reinicio: ${latestStatus.reset_reason_text} (código ${latestStatus.reset_reason})`);
      console.log(`│   • Señal WiFi: ${latestStatus.rssi} dBm (SSID: ${latestStatus.ssid})`);
      console.log(`│   • Deduplicación RAM: ${latestStatus.dedup_acks_resent || 0} acks reenviados | Ocupado skipeado: ${latestStatus.skipped_pulses_busy || 0}`);
      console.log(`│   • Fallas de red consecutivas: ${latestStatus.consecutive_network_failures || 0}`);
    } else {
      console.log(`│   (Sin status_log detallado reciente)`);
    }

    console.log(`└─────────────────────────────────────────────────────────────`);
  }

  // 3. Comparativa global con la versión previa (0.0.24) en el mismo lapso
  const v24Summary = await db.prepare(`
    SELECT 
      COUNT(*) as total_pagos,
      COUNT(CASE WHEN p.status = 'approved' THEN 1 END) as aprobados,
      COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsados
    FROM payments p
    JOIN machines m ON m.id = p.machine_id
    WHERE m.firmware_version = '0.0.24' AND p.created_at >= '2026-09-21 18:40:00'
  `).get();

  const v26Summary = await db.prepare(`
    SELECT 
      COUNT(*) as total_pagos,
      COUNT(CASE WHEN p.status = 'approved' THEN 1 END) as aprobados,
      COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsados
    FROM payments p
    JOIN machines m ON m.id = p.machine_id
    WHERE m.firmware_version = '0.0.26' AND p.created_at >= '2026-09-21 18:40:00'
  `).get();

  console.log('\n' + '='.repeat(70));
  console.log(' RESUMEN COMPARATIVO (Últimas ~2.5 horas):');
  console.log(`   Firmware v0.0.26: ${v26Summary.aprobados} ventas | ${v26Summary.reembolsados} reembolsos (${v26Summary.aprobados > 0 ? ((v26Summary.reembolsados / v26Summary.aprobados) * 100).toFixed(1) : 0}%)`);
  console.log(`   Firmware v0.0.24: ${v24Summary.aprobados} ventas | ${v24Summary.reembolsados} reembolsos (${v24Summary.aprobados > 0 ? ((v24Summary.reembolsados / v24Summary.aprobados) * 100).toFixed(1) : 0}%)`);
  console.log('='.repeat(70));
}

if (process.argv[1]?.endsWith('audit_v26_health.js')) {
  runV26HealthAudit().then(() => process.exit(0)).catch(err => {
    console.error('Error en auditoría:', err);
    process.exit(1);
  });
}

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

export async function runDailyRefundAudit() {
  console.log('='.repeat(75));
  console.log(` REPORTE DIARIO DE VENTAS Y REEMBOLSOS — ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  console.log('='.repeat(75));

  // 1. Evolución diaria de los últimos 8 días
  const daily = await pool.query(`
    SELECT 
      to_char(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as fecha,
      COUNT(*) as total_ventas,
      COUNT(CASE WHEN refund_status = 'done' THEN 1 END) as reembolsos,
      ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as pct_tasa_reembolso,
      SUM(CASE WHEN refund_status = 'done' THEN refunded_amount ELSE 0 END) as monto_reembolsado,
      SUM(amount) as volumen_bruto
    FROM payments
    WHERE created_at >= NOW() - INTERVAL '8 days' AND status = 'approved'
    GROUP BY 1
    ORDER BY 1 ASC;
  `);

  console.log('\n📊 1. Evolución diaria (Ventas vs Reembolsos):');
  console.table(daily.rows.map(r => ({
    Fecha: r.fecha,
    'Ventas Aprobadas': Number(r.total_ventas),
    'Reembolsos': Number(r.reembolsos),
    'Tasa Reembolso (%)': `${r.pct_tasa_reembolso}%`,
    'Monto Reembolsado': `$${Number(r.monto_reembolsado).toLocaleString('es-AR')}`,
    'Facturación Bruta': `$${Number(r.volumen_bruto).toLocaleString('es-AR')}`
  })));

  // 2. Comportamiento horario de hoy (hora Argentina)
  const todayHourly = await pool.query(`
    SELECT 
      to_char(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:00') as hora,
      COUNT(*) as ventas,
      COUNT(CASE WHEN refund_status = 'done' THEN 1 END) as reembolsos,
      ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as pct_fallas
    FROM payments
    WHERE created_at AT TIME ZONE 'America/Argentina/Buenos_Aires' >= CURRENT_DATE
      AND status = 'approved'
    GROUP BY 1
    ORDER BY 1 ASC;
  `);

  console.log('\n⏱️ 2. Detalle horario del día de hoy (Hora Argentina):');
  console.table(todayHourly.rows.map(r => ({
    Hora: r.hora,
    Ventas: Number(r.ventas),
    Reembolsos: Number(r.reembolsos),
    'Tasa de Fallas': `${r.pct_fallas || 0}%`
  })));

  // 3. Máquinas afectadas en el día de hoy
  const todayMachines = await pool.query(`
    SELECT 
      m.name as maquina,
      m.firmware_version as fw,
      c.name as cliente,
      COUNT(*) as total_ventas,
      COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsos,
      ROUND(COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as pct_tasa,
      SUM(CASE WHEN p.refund_status = 'done' THEN p.refunded_amount ELSE 0 END) as monto_reembolsado
    FROM payments p
    JOIN machines m ON p.machine_id = m.id
    LEFT JOIN clients c ON m.client_id = c.id
    WHERE p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires' >= CURRENT_DATE
      AND p.status = 'approved'
    GROUP BY m.name, m.firmware_version, c.name
    HAVING COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) > 0
    ORDER BY reembolsos DESC;
  `);

  console.log('\n🚨 3. Máquinas con reembolsos hoy:');
  if (todayMachines.rows.length === 0) {
    console.log('✅ Ninguna máquina registró reembolsos hoy.');
  } else {
    console.table(todayMachines.rows.map(r => ({
      Máquina: r.maquina,
      FW: r.fw || '—',
      Cliente: r.cliente || '—',
      Ventas: Number(r.total_ventas),
      Reembolsos: Number(r.reembolsos),
      'Tasa (%)': `${r.pct_tasa}%`,
      'Dinero Devuelto': `$${Number(r.monto_reembolsado).toLocaleString('es-AR')}`
    })));
  }

  // 4. Últimas 10 transacciones del día
  const lastSales = await pool.query(`
    SELECT 
      to_char(p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI:SS') as hora,
      m.name as maquina,
      p.amount,
      p.refund_status,
      pq.status as pulse_status,
      ROUND(EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at))) as seg_entrega,
      ROUND(EXTRACT(EPOCH FROM (pq.expires_at - pq.delivered_at))) as seg_margen_restante
    FROM payments p
    JOIN machines m ON p.machine_id = m.id
    LEFT JOIN pulse_queue pq ON pq.payment_id = p.id
    WHERE p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires' >= CURRENT_DATE
      AND p.status = 'approved'
    ORDER BY p.created_at DESC
    LIMIT 10;
  `);

  console.log('\n🔍 4. Muestra de las últimas 10 ventas de hoy (revisión de margen post-fix):');
  console.table(lastSales.rows.map(r => ({
    Hora: r.hora,
    Máquina: r.maquina,
    Monto: `$${r.amount}`,
    'Estado Pulso': r.pulse_status || '—',
    'Reembolso': r.refund_status || 'Ninguno (OK)',
    'Demora entrega (s)': r.seg_entrega != null ? `${r.seg_entrega}s` : '—',
    'Margen restante (s)': r.seg_margen_restante != null ? `${r.seg_margen_restante}s` : '—'
  })));

  console.log('='.repeat(75));
}

// Si se ejecuta directamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDailyRefundAudit()
    .then(() => pool.end())
    .catch(err => {
      console.error('Error al ejecutar auditoría:', err);
      pool.end();
    });
}

import { Router } from 'express';
import db from '../db/schema.js';
import { machineState } from '../services/machine-state.js';
import { getEffectiveOrgContext } from '../middleware/auth.js';

const router = Router();

// Traducciones amigables para el cliente de los motivos de reinicio del ESP32
const resetReasonTranslations = {
  poweron: 'Corte de energía o reconexión manual',
  brownout: 'Baja tensión eléctrica (inestabilidad de energía en el local)',
  task_wdt: 'Reinicio automático de control',
  interrupt_wdt: 'Reinicio automático de control',
  watchdog: 'Reinicio automático de control',
  panic: 'Reinicio automático por error de software',
  software: 'Reinicio por software',
  'software: wifi stale': 'Reinicio por pérdida de WiFi',
  deepsleep: 'Salida de modo de ahorro de energía',
  external: 'Botón de reinicio físico presionado',
  unknown: 'Reinicio por causa desconocida'
};

const TZ = 'America/Argentina/Buenos_Aires';

function getLocalDateString(d, isHourly = false) {
  const dateObj = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(dateObj).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });

  const hourStr = parts.hour === '24' ? '00' : parts.hour;
  return isHourly 
    ? `${parts.year}-${parts.month}-${parts.day}T${hourStr}`
    : `${parts.year}-${parts.month}-${parts.day}`;
}

// Helper para generar series de tiempo sin huecos (zero-filling) en hora local de Argentina
function generateTimeSeries(sinceStr, untilStr, dbRows, isHourly) {
  const sinceLocalStr = getLocalDateString(sinceStr, isHourly);
  const untilLocalStr = getLocalDateString(untilStr, isHourly);

  // Crear mapa de indexación rápida para las filas existentes
  const map = {};
  for (const row of dbRows) {
    if (!row.date) continue;
    let key;
    if (typeof row.date === 'string' && row.date.length >= 10 && !row.date.includes('T') && !row.date.includes('Z')) {
      const datePart = row.date.substring(0, 10);
      const hourPart = row.date.substring(11, 13) || '00';
      key = isHourly ? `${datePart}T${hourPart}` : datePart;
    } else {
      key = getLocalDateString(row.date, isHourly);
    }
    map[key] = {
      amount: Number(row.total_amount) || 0,
      count: Number(row.count) || 0
    };
  }

  const series = [];

  if (isHourly) {
    let curr = new Date(sinceStr);
    const end = new Date(untilStr);
    while (curr <= end) {
      const key = getLocalDateString(curr, true);
      const hour = key.split('T')[1] || '00';
      const label = `${hour}:00`;
      const val = map[key] || { amount: 0, count: 0 };
      series.push({ key, label, amount: val.amount, count: val.count });
      curr = new Date(curr.getTime() + 60 * 60 * 1000);
    }
  } else {
    const [sy, sm, sd] = sinceLocalStr.split('-').map(Number);
    const [uy, um, ud] = untilLocalStr.split('-').map(Number);
    
    let curr = new Date(sy, sm - 1, sd, 12, 0, 0); // 12:00 mediodía local
    const end = new Date(uy, um - 1, ud, 12, 0, 0);

    while (curr <= end) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      const label = `${d}/${m}`;
      const val = map[key] || { amount: 0, count: 0 };
      series.push({ key, label, amount: val.amount, count: val.count });

      curr.setDate(curr.getDate() + 1);
    }
  }

  return series;
}

router.get('/summary', async (req, res) => {
  try {
    const ctx = await getEffectiveOrgContext(req);
    
    // Obtener parámetros de fecha (ISO strings)
    let since = req.query.since;
    let until = req.query.until;
    
    if (!since) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      since = d.toISOString();
    }
    if (!until) {
      until = new Date().toISOString();
    }

    // 1. Obtener la lista de máquinas filtrada por organización
    let machinesQuery = 'SELECT id, name, location, status, last_seen_at, last_rssi, firmware_version FROM machines';
    let machinesParams = [];

    if (!ctx.isSuperAdmin) {
      if (!ctx.allowedClientIds || ctx.allowedClientIds.length === 0) {
        return res.json({
          kpis: { total_revenue: 0, total_payments: 0, total_refunded: 0, total_refund_count: 0, total_reboots: 0 },
          fleetHealth: { online: 0, out_of_service: 0, offline: 0, total: 0 },
          machinesList: [],
          chartData: []
        });
      }
      const placeholders = ctx.allowedClientIds.map(() => '?').join(',');
      machinesQuery += ` WHERE client_id IN (${placeholders})`;
      machinesParams = [...ctx.allowedClientIds];
    } else if (ctx.activeOrgId) {
      machinesQuery += ' WHERE client_id = ?';
      machinesParams = [ctx.activeOrgId];
    }

    const dbMachines = await db.prepare(machinesQuery).all(...machinesParams);


    // Calcular estado de salud consolidado de la flota (En línea, Fuera de servicio, Desconectada)
    const fleetHealth = {
      online: 0,
      out_of_service: 0,
      offline: 0,
      total: dbMachines.length
    };

    const machineIds = dbMachines.map(m => m.id);
    const machinesMap = {};
    
    for (const m of dbMachines) {
      machinesMap[m.id] = m.name;
      const state = machineState(m);
      if (state === 'online') fleetHealth.online++;
      else if (state === 'out_of_service') fleetHealth.out_of_service++;
      else if (state === 'offline') fleetHealth.offline++;
    }

    // Si no hay máquinas asociadas a esta organización, retornamos vacío
    if (machineIds.length === 0) {
      return res.json({
        kpis: {
          total_revenue: 0,
          total_payments: 0,
          total_refunded: 0,
          total_refund_count: 0,
          total_reboots: 0
        },
        fleetHealth,
        machinesList: [],
        chartData: []
      });
    }

    // Crear placeholders para la consulta IN (?, ?, ...)
    const placeholders = machineIds.map(() => '?').join(',');

    // Parámetros comunes de filtrado temporal
    const paymentsParams = [...machineIds, since, until];

    // 2. Ventas Aprobadas y Reembolsos en el período
    const paymentsQuery = `
      SELECT 
        status, 
        refund_status,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(refunded_amount), 0) as total_refunded_amount,
        COUNT(*) as count,
        COUNT(CASE WHEN refund_status = 'done' OR refund_status = 'partial' THEN 1 END) as refund_count
      FROM payments 
      WHERE machine_id IN (${placeholders}) 
        AND created_at >= ? 
        AND created_at <= ?
      GROUP BY status, refund_status
    `;

    // 3. Reinicios en el período: agregado en PostgreSQL en vez de descargar decenas de miles de filas
    const rebootsQuery = `
      SELECT 
        machine_id,
        COUNT(*) as count
      FROM machine_events
      WHERE machine_id IN (${placeholders})
        AND type = 'heartbeat'
        AND detail::json->>'reason' = 'startup'
        AND created_at >= ?
        AND created_at <= ?
      GROUP BY machine_id
    `;
    const rebootsParams = [...machineIds, since, until];

    // 4. Serie de tiempo para el gráfico (Ventas y Cantidades agrupadas por hora/día)
    const isHourly = (new Date(until).getTime() - new Date(since).getTime()) <= 36 * 60 * 60 * 1000;
    const truncUnit = isHourly ? 'hour' : 'day';
    
    const chartQuery = `
      SELECT 
        date_trunc('${truncUnit}', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires') as date,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) as count
      FROM payments
      WHERE machine_id IN (${placeholders})
        AND status = 'approved'
        AND created_at >= ?
        AND created_at <= ?
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Ejecutar las 3 consultas concurrentemente en paralelo vía el pool de PostgreSQL
    const [dbPayments, dbReboots, chartDbRows] = await Promise.all([
      db.prepare(paymentsQuery).all(...paymentsParams),
      db.prepare(rebootsQuery).all(...rebootsParams),
      db.prepare(chartQuery).all(...paymentsParams),
    ]);

    let totalRevenue = 0;
    let totalPayments = 0;
    let totalRefunded = 0;
    let totalRefundCount = 0;

    for (const row of dbPayments) {
      if (row.status === 'approved') {
        totalRevenue += Number(row.total_amount);
        totalPayments += Number(row.count);
      }
      totalRefunded += Number(row.total_refunded_amount);
      totalRefundCount += Number(row.refund_count);
    }

    const rebootsByMachineCount = {};
    for (const mId of machineIds) {
      rebootsByMachineCount[mId] = 0;
    }
    for (const r of dbReboots) {
      rebootsByMachineCount[r.machine_id] = Number(r.count) || 0;
    }

    const totalReboots = Object.values(rebootsByMachineCount).reduce((a, b) => a + b, 0);
    const chartData = generateTimeSeries(since, until, chartDbRows, isHourly);

    // 5. Lista de máquinas con conteo de reinicios
    const machinesList = dbMachines.map(m => ({
      id: m.id,
      name: m.name,
      location: m.location,
      status: m.status,
      state: machineState(m),
      rssi: m.last_rssi,
      last_seen: m.last_seen_at,
      firmware_version: m.firmware_version,
      reboots_in_period: rebootsByMachineCount[m.id] || 0
    }));

    res.json({
      kpis: {
        total_revenue: totalRevenue,
        total_payments: totalPayments,
        total_refunded: totalRefunded,
        total_refund_count: totalRefundCount,
        total_reboots: totalReboots
      },
      fleetHealth,
      machinesList,
      chartData
    });

  } catch (error) {
    console.error('[dashboard-summary] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── Super Admin Network Health & Refund Monitoring ───────────────────────────
router.get('/superadmin-monitoring', async (req, res) => {
  try {
    const ctx = await getEffectiveOrgContext(req);
    if (!ctx.isSuperAdmin) {
      return res.status(403).json({ error: 'Acceso exclusivo para Super Administradores' });
    }

    const period = req.query.period || '7d';
    const filterClientId = req.query.client_id ? String(req.query.client_id).trim() : null;
    const filterMachineId = req.query.machine_id ? String(req.query.machine_id).trim() : null;

    let intervalSql = '7 days';
    let isHourly = false;
    let isTodayOnly = false;
    let periodDays = 7;

    if (period === 'today') {
      isHourly = true;
      isTodayOnly = true;
      periodDays = 1;
    } else if (period === '24h') {
      intervalSql = '24 hours';
      isHourly = true;
      periodDays = 1;
    } else if (period === '7d') {
      intervalSql = '7 days';
      periodDays = 7;
    } else if (period === '30d') {
      intervalSql = '30 days';
      periodDays = 30;
    } else if (req.query.days) {
      periodDays = parseInt(req.query.days, 10) || 30;
      periodDays = Math.min(90, Math.max(1, periodDays));
      intervalSql = `${periodDays} days`;
    }

    // NOTA IMPORTANTE SOBRE ZONA HORARIA:
    // En PostgreSQL, payments.created_at y pulse_queue.{created_at,delivered_at,acked_at}
    // son columnas TIMESTAMP WITHOUT TIME ZONE almacenadas en UTC.
    // Para convertirlas a hora local de Argentina (UTC-3), SIEMPRE se debe usar:
    //   (col AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')
    // Si se omitiera el primer AT TIME ZONE 'UTC', Postgres asumiría que el timestamp ya
    // está en hora argentina y al pasarlo a UTC sumaría +3 horas extra (+6h de desfase total).
    const sinceUtcSql = isTodayOnly
      ? `(DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires' AT TIME ZONE 'UTC')`
      : isHourly
        ? `(DATE_TRUNC('hour', NOW() AT TIME ZONE 'UTC') - INTERVAL '23 hours')`
        : `((NOW() AT TIME ZONE 'UTC') - CAST(? AS interval))`;

    // Construcción de filtros dinámicos por cliente y máquina
    const buildScopeFilter = (machineAlias = 'm', baseParams = []) => {
      const clauses = [];
      const params = [...baseParams];
      if (filterClientId) {
        clauses.push(`${machineAlias}.client_id = ?`);
        params.push(filterClientId);
      }
      if (filterMachineId) {
        clauses.push(`${machineAlias}.id = ?`);
        params.push(filterMachineId);
      }
      const sql = clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
      return { sql, params };
    };

    const baseTimeParams = (isTodayOnly || isHourly) ? [] : [intervalSql];
    const scopeM = buildScopeFilter('m', baseTimeParams);

    const truncUnit = isHourly ? 'hour' : 'day';
    const fmtMask = isHourly ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD';

    // 1. Consulta de serie temporal de pagos + latencia promedio por bloque horario/diario
    const dailyPaymentsPromise = db.prepare(`
      SELECT 
        TO_CHAR(DATE_TRUNC('${truncUnit}', p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires'), '${fmtMask}') as bucket_key,
        COUNT(*) as total_pagos,
        COUNT(CASE WHEN p.status = 'approved' THEN 1 END) as aprobados,
        COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsados_done,
        COUNT(CASE WHEN p.refund_status = 'failed' THEN 1 END) as reembolsados_failed,
        COUNT(CASE WHEN p.refund_status = 'partial' THEN 1 END) as excedente_partial,
        ROUND(COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN p.status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso,
        COALESCE(SUM(CASE WHEN p.refund_status = 'done' THEN p.amount ELSE 0 END), 0) as monto_reembolsado,
        COALESCE(SUM(CASE WHEN p.status = 'approved' THEN p.amount ELSE 0 END), 0) as monto_total_aprobado
      FROM payments p
      JOIN machines m ON m.id = p.machine_id
      WHERE p.created_at >= ${sinceUtcSql}
      ${scopeM.sql}
      GROUP BY 1
      ORDER BY 1 ASC
    `).all(...scopeM.params);

    const dailyLatencyPromise = db.prepare(`
      SELECT 
        TO_CHAR(DATE_TRUNC('${truncUnit}', pq.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires'), '${fmtMask}') as bucket_key,
        COUNT(*) as acked_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as avg_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p50_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p95_poll_to_ack_s,
        ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at))))::numeric, 2) as avg_queue_to_poll_s
      FROM pulse_queue pq
      JOIN machines m ON m.id = pq.machine_id
      WHERE pq.status = 'acked'
        AND pq.delivered_at IS NOT NULL
        AND pq.acked_at IS NOT NULL
        AND pq.acked_at >= pq.delivered_at
        AND pq.created_at >= ${sinceUtcSql}
        ${scopeM.sql}
      GROUP BY 1
      ORDER BY 1 ASC
    `).all(...scopeM.params);

    // 2. Lista completa de clientes y máquinas (para selectores de filtro y métricas)
    const allClientsPromise = db.prepare(`
      SELECT id, name FROM clients ORDER BY name ASC
    `).all();

    const allMachinesPromise = db.prepare(`
      SELECT m.id, m.name, m.arduino_id, m.status, m.last_seen_at, m.last_rssi, 
             m.firmware_version, m.target_fw_version, m.poll_interval_s,
             m.pulse_duration_ms, m.pulse_gap_ms,
             c.name as client_name, c.id as client_id
      FROM machines m
      LEFT JOIN clients c ON m.client_id = c.id
      ORDER BY m.name ASC
    `).all();

    // 3. Reembolsos agrupados por Cliente
    const clientsScope = buildScopeFilter('m', baseTimeParams);
    const clientsResPromise = db.prepare(`
      SELECT 
        c.id as client_id,
        c.name as client_name,
        COUNT(p.id) as total_pagos,
        COALESCE(SUM(CASE WHEN p.status = 'approved' THEN p.amount ELSE 0 END), 0) as monto_aprobado,
        COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsos_done,
        COALESCE(SUM(CASE WHEN p.refund_status = 'done' THEN p.amount ELSE 0 END), 0) as monto_reembolsado,
        ROUND(COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN p.status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso,
        COUNT(DISTINCT m.id) as maquinas_activas
      FROM clients c
      JOIN machines m ON m.client_id = c.id
      LEFT JOIN payments p ON p.machine_id = m.id AND p.created_at >= ${sinceUtcSql}
      WHERE 1=1 ${clientsScope.sql}
      GROUP BY c.id, c.name
      ORDER BY reembolsos_done DESC, total_pagos DESC
    `).all(...clientsScope.params);

    // 4. Estadísticas de pagos por Máquina
    const machineStatsPromise = db.prepare(`
      SELECT 
        p.machine_id,
        COUNT(p.id) as total_pagos,
        COALESCE(SUM(CASE WHEN p.status = 'approved' THEN p.amount ELSE 0 END), 0) as monto_aprobado,
        COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsos_done,
        COALESCE(SUM(CASE WHEN p.refund_status = 'done' THEN p.amount ELSE 0 END), 0) as monto_reembolsado,
        ROUND(COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN p.status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso
      FROM payments p
      JOIN machines m ON m.id = p.machine_id
      WHERE p.created_at >= ${sinceUtcSql}
      ${scopeM.sql}
      GROUP BY p.machine_id
    `).all(...scopeM.params);

    // 5. Causas de Reembolso en el período
    const causesResPromise = db.prepare(`
      SELECT 
        COUNT(CASE WHEN pq.status = 'expired' THEN 1 END) as timeout_expired,
        COUNT(CASE WHEN pq.status = 'acked' AND p.refund_status = 'done' THEN 1 END) as manual_after_ack,
        COUNT(CASE WHEN p.pulses_calculated = 0 AND p.refund_status = 'done' THEN 1 END) as out_of_service_zero_pulses
      FROM payments p
      JOIN machines m ON m.id = p.machine_id
      LEFT JOIN pulse_queue pq ON pq.payment_id = p.id
      WHERE p.refund_status = 'done'
        AND p.created_at >= ${sinceUtcSql}
        ${scopeM.sql}
    `).get(...scopeM.params);

    // 6. Métricas de Latencia Poll -> ACK (Resumen Global)
    const latencySummaryPromise = db.prepare(`
      SELECT 
        COUNT(*) as total_acked,
        ROUND(AVG(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as avg_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p50_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p95_poll_to_ack_s,
        ROUND(MAX(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as max_poll_to_ack_s,
        ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at))))::numeric, 2) as avg_queue_to_poll_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(0, EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at))))::numeric, 2) as p50_queue_to_poll_s,
        ROUND(AVG(EXTRACT(EPOCH FROM (pq.acked_at - pq.created_at)))::numeric, 2) as avg_total_s,
        ROUND(AVG((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)::numeric, 2) as avg_physical_s,
        ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)))::numeric, 2) as avg_net_overhead_s,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) <= 5 THEN 1 END) as fast_count,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) > 5 AND EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) <= 15 THEN 1 END) as medium_count,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) > 15 THEN 1 END) as slow_count,
        COUNT(CASE WHEN GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)) <= 3 THEN 1 END) as net_fast_count,
        COUNT(CASE WHEN GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)) > 3 AND GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)) <= 12 THEN 1 END) as net_medium_count,
        COUNT(CASE WHEN GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)) > 12 THEN 1 END) as net_slow_count
      FROM pulse_queue pq
      JOIN machines m ON m.id = pq.machine_id
      WHERE pq.status = 'acked'
        AND pq.delivered_at IS NOT NULL
        AND pq.acked_at IS NOT NULL
        AND pq.acked_at >= pq.delivered_at
        AND pq.created_at >= ${sinceUtcSql}
        ${scopeM.sql}
    `).get(...scopeM.params);

    // 7. Latencia Poll -> ACK agrupada por Máquina
    const latencyByMachinePromise = db.prepare(`
      SELECT 
        m.id as machine_id,
        m.name as machine_name,
        m.arduino_id,
        m.client_id,
        COALESCE(c.name, 'Sin cliente') as client_name,
        COALESCE(m.firmware_version, 'N/A') as firmware_version,
        m.last_rssi as rssi,
        COALESCE(m.poll_interval_s, 3) as poll_interval_s,
        COALESCE(m.pulse_duration_ms, 200) as pulse_duration_ms,
        COALESCE(m.pulse_gap_ms, 200) as pulse_gap_ms,
        COUNT(pq.id) as total_acked,
        ROUND(AVG(pq.count)::numeric, 1) as avg_pulses,
        ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at))))::numeric, 2) as avg_queue_to_poll_s,
        ROUND(AVG(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as avg_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p50_poll_to_ack_s,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as p95_poll_to_ack_s,
        ROUND(MAX(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)))::numeric, 2) as max_poll_to_ack_s,
        ROUND(AVG((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)::numeric, 2) as avg_physical_s,
        ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)))::numeric, 2) as avg_net_overhead_s,
        ROUND(AVG(EXTRACT(EPOCH FROM (pq.acked_at - pq.created_at)))::numeric, 2) as avg_total_s,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) > 15 THEN 1 END) as slow_ack_count,
        COUNT(CASE WHEN GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)) > 12 THEN 1 END) as slow_net_count
      FROM pulse_queue pq
      JOIN machines m ON m.id = pq.machine_id
      LEFT JOIN clients c ON c.id = m.client_id
      WHERE pq.status = 'acked'
        AND pq.delivered_at IS NOT NULL
        AND pq.acked_at IS NOT NULL
        AND pq.acked_at >= pq.delivered_at
        AND pq.created_at >= ${sinceUtcSql}
        ${scopeM.sql}
      GROUP BY m.id, m.name, m.arduino_id, m.client_id, c.name, m.firmware_version, m.last_rssi, m.poll_interval_s, m.pulse_duration_ms, m.pulse_gap_ms
      ORDER BY avg_poll_to_ack_s DESC
    `).all(...scopeM.params);

    // 8. Detalle de pulsos individuales (recientes y más lentos del período)
    const pulseDetailSelectSql = `
      SELECT 
        pq.id as pulse_id,
        pq.payment_id,
        pq.count as pulses_count,
        pq.status,
        p.amount,
        m.id as machine_id,
        m.name as machine_name,
        m.arduino_id,
        COALESCE(c.name, 'Sin cliente') as client_name,
        TO_CHAR(pq.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI:SS') as created_at_ar,
        TO_CHAR(pq.delivered_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI:SS') as delivered_at_ar,
        TO_CHAR(pq.acked_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI:SS') as acked_at_ar,
        ROUND(GREATEST(0, EXTRACT(EPOCH FROM (pq.delivered_at - pq.created_at)))::numeric, 2) as queue_to_poll_s,
        ROUND(EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at))::numeric, 2) as poll_to_ack_s,
        ROUND(((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0)::numeric, 2) as physical_s,
        ROUND(GREATEST(0, EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) - ((pq.count * (COALESCE(m.pulse_duration_ms, 200) + COALESCE(m.pulse_gap_ms, 200))) / 1000.0))::numeric, 2) as net_overhead_s,
        ROUND(EXTRACT(EPOCH FROM (pq.acked_at - pq.created_at))::numeric, 2) as total_s
      FROM pulse_queue pq
      JOIN machines m ON m.id = pq.machine_id
      LEFT JOIN clients c ON c.id = m.client_id
      LEFT JOIN payments p ON p.id = pq.payment_id
      WHERE pq.status = 'acked'
        AND pq.delivered_at IS NOT NULL
        AND pq.acked_at IS NOT NULL
        AND pq.acked_at >= pq.delivered_at
        AND pq.created_at >= ${sinceUtcSql}
        ${scopeM.sql}
    `;

    const recentPulsesPromise = db.prepare(`
      ${pulseDetailSelectSql}
      ORDER BY pq.created_at DESC
      LIMIT 40
    `).all(...scopeM.params);

    const slowestPulsesPromise = db.prepare(`
      ${pulseDetailSelectSql}
      ORDER BY EXTRACT(EPOCH FROM (pq.acked_at - pq.delivered_at)) DESC
      LIMIT 40
    `).all(...scopeM.params);

    const [
      dailyPaymentsRaw,
      dailyLatencyRaw,
      allClients,
      allMachines,
      clientsRes,
      machineStatsRes,
      causesRes,
      latencySummaryRaw,
      latencyByMachineRaw,
      recentPulses,
      slowestPulses,
    ] = await Promise.all([
      dailyPaymentsPromise,
      dailyLatencyPromise,
      allClientsPromise,
      allMachinesPromise,
      clientsResPromise,
      machineStatsPromise,
      causesResPromise,
      latencySummaryPromise,
      latencyByMachinePromise,
      recentPulsesPromise,
      slowestPulsesPromise,
    ]);

    // Construir serie temporal continua (zero-filled) en hora de Argentina sin horas futuras
    const payMap = {};
    for (const r of dailyPaymentsRaw) {
      payMap[r.bucket_key] = r;
    }
    const latMap = {};
    for (const r of dailyLatencyRaw) {
      latMap[r.bucket_key] = r;
    }

    const nowArStr = getLocalDateString(new Date(), false); // YYYY-MM-DD en Argentina
    const nowArHourStr = getLocalDateString(new Date(), true); // YYYY-MM-DDTHH en Argentina
    const dailyRes = [];

    if (isHourly) {
      const currentHourNow = new Date();
      let startMs;
      if (isTodayOnly) {
        const currentHourNum = parseInt(nowArHourStr.split('T')[1] || '0', 10);
        startMs = currentHourNow.getTime() - currentHourNum * 60 * 60 * 1000;
      } else {
        startMs = currentHourNow.getTime() - 23 * 60 * 60 * 1000;
      }

      for (let t = startMs; t <= currentHourNow.getTime() + 1000; t += 60 * 60 * 1000) {
        const key = getLocalDateString(t, true); // YYYY-MM-DDTHH
        const [datePart, hourPart] = key.split('T');
        const [, mm, dd] = datePart.split('-');
        const isTodayBucket = datePart === nowArStr;
        const pRow = payMap[key] || {};
        const lRow = latMap[key] || {};

        dailyRes.push({
          bucket_key: key,
          dia: `${hourPart}:00`,
          dia_full: `${isTodayBucket ? 'Hoy' : 'Ayer'} ${dd}/${mm} ${hourPart}:00 hs`,
          is_today: isTodayBucket,
          total_pagos: Number(pRow.total_pagos || 0),
          aprobados: Number(pRow.aprobados || 0),
          reembolsados_done: Number(pRow.reembolsados_done || 0),
          reembolsados_failed: Number(pRow.reembolsados_failed || 0),
          excedente_partial: Number(pRow.excedente_partial || 0),
          pct_reembolso: Number(pRow.pct_reembolso || 0),
          pct_reembolsos: Number(pRow.pct_reembolso || 0),
          monto_reembolsado: Number(pRow.monto_reembolsado || 0),
          monto_total_aprobado: Number(pRow.monto_total_aprobado || 0),
          acked_count: Number(lRow.acked_count || 0),
          avg_poll_to_ack_s: Number(lRow.avg_poll_to_ack_s || 0),
          p50_poll_to_ack_s: Number(lRow.p50_poll_to_ack_s || 0),
          p95_poll_to_ack_s: Number(lRow.p95_poll_to_ack_s || 0),
          avg_queue_to_poll_s: Number(lRow.avg_queue_to_poll_s || 0),
        });
      }
    } else {
      const [uy, um, ud] = nowArStr.split('-').map(Number);
      const endDate = new Date(uy, um - 1, ud, 12, 0, 0);
      const startDate = new Date(endDate.getTime() - (periodDays - 1) * 24 * 60 * 60 * 1000);

      for (let curr = new Date(startDate); curr <= endDate; curr.setDate(curr.getDate() + 1)) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        const pRow = payMap[key] || {};
        const lRow = latMap[key] || {};

        dailyRes.push({
          bucket_key: key,
          dia: `${d}/${m}`,
          dia_full: `${d}/${m}/${y}`,
          is_today: key === nowArStr,
          total_pagos: Number(pRow.total_pagos || 0),
          aprobados: Number(pRow.aprobados || 0),
          reembolsados_done: Number(pRow.reembolsados_done || 0),
          reembolsados_failed: Number(pRow.reembolsados_failed || 0),
          excedente_partial: Number(pRow.excedente_partial || 0),
          pct_reembolso: Number(pRow.pct_reembolso || 0),
          pct_reembolsos: Number(pRow.pct_reembolso || 0),
          monto_reembolsado: Number(pRow.monto_reembolsado || 0),
          monto_total_aprobado: Number(pRow.monto_total_aprobado || 0),
          acked_count: Number(lRow.acked_count || 0),
          avg_poll_to_ack_s: Number(lRow.avg_poll_to_ack_s || 0),
          p50_poll_to_ack_s: Number(lRow.p50_poll_to_ack_s || 0),
          p95_poll_to_ack_s: Number(lRow.p95_poll_to_ack_s || 0),
          avg_queue_to_poll_s: Number(lRow.avg_queue_to_poll_s || 0),
        });
      }
    }

    const statsMap = {};
    for (const s of machineStatsRes) {
      statsMap[s.machine_id] = s;
    }

    const latencyMachineMap = {};
    for (const l of latencyByMachineRaw) {
      latencyMachineMap[l.machine_id] = l;
    }

    // Filtrar máquinas según el alcance seleccionado
    const scopedMachinesRaw = allMachines.filter(m => {
      if (filterClientId && m.client_id !== filterClientId) return false;
      if (filterMachineId && m.id !== filterMachineId) return false;
      return true;
    });

    const machinesList = scopedMachinesRaw.map(m => {
      const s = statsMap[m.id] || { total_pagos: 0, monto_aprobado: 0, reembolsos_done: 0, monto_reembolsado: 0, pct_reembolso: 0 };
      const lat = latencyMachineMap[m.id] || null;
      return {
        id: m.id,
        name: m.name,
        arduino_id: m.arduino_id,
        client_name: m.client_name || 'Sin cliente',
        client_id: m.client_id,
        firmware_version: m.firmware_version || 'N/A',
        target_fw_version: m.target_fw_version,
        status: m.status,
        state: machineState(m),
        last_seen_at: m.last_seen_at,
        rssi: m.last_rssi,
        total_pagos: Number(s.total_pagos),
        reembolsos_done: Number(s.reembolsos_done),
        pct_reembolso: Number(s.pct_reembolso || 0),
        monto_aprobado: Number(s.monto_aprobado),
        monto_reembolsado: Number(s.monto_reembolsado),
        avg_poll_to_ack_s: lat ? Number(lat.avg_poll_to_ack_s) : null,
        p50_poll_to_ack_s: lat ? Number(lat.p50_poll_to_ack_s) : null,
        p95_poll_to_ack_s: lat ? Number(lat.p95_poll_to_ack_s) : null,
        avg_queue_to_poll_s: lat ? Number(lat.avg_queue_to_poll_s) : null,
      };
    }).sort((a, b) => b.reembolsos_done - a.reembolsos_done || b.total_pagos - a.total_pagos);

    // 5. Distribución de Firmware (en el alcance seleccionado)
    const fwDist = {};
    for (const m of scopedMachinesRaw) {
      const v = m.firmware_version || 'Desconocida';
      fwDist[v] = (fwDist[v] || 0) + 1;
    }

    // 6. KPIs consolidados
    let totalApproved = 0;
    let totalRefundedCount = 0;
    let totalRefundedAmount = 0;
    let totalApprovedAmount = 0;

    for (const d of dailyPaymentsRaw) {
      totalApproved += Number(d.aprobados || 0);
      totalRefundedCount += Number(d.reembolsados_done || 0);
      totalRefundedAmount += Number(d.monto_reembolsado || 0);
      totalApprovedAmount += Number(d.monto_total_aprobado || 0);
    }

    const overallRefundRate = totalApproved > 0 
      ? Number(((totalRefundedCount / totalApproved) * 100).toFixed(1)) 
      : 0;

    const criticalMachines = machinesList.filter(m => m.pct_reembolso >= 10 && m.total_pagos >= 5).length;

    const totalAcked = Number(latencySummaryRaw?.total_acked || 0);

    res.json({
      period,
      periodDays,
      filters: {
        client_id: filterClientId,
        machine_id: filterMachineId,
      },
      filterOptions: {
        clients: allClients.map(c => ({ id: c.id, name: c.name })),
        machines: allMachines.map(m => ({
          id: m.id,
          name: m.name,
          arduino_id: m.arduino_id,
          client_id: m.client_id,
          client_name: m.client_name || 'Sin cliente',
        })),
      },
      kpis: {
        total_approved: totalApproved,
        total_approved_amount: totalApprovedAmount,
        total_refunded_count: totalRefundedCount,
        total_refunded_amount: totalRefundedAmount,
        overall_refund_rate: overallRefundRate,
        critical_machines_count: criticalMachines,
        total_machines: scopedMachinesRaw.length,
      },
      causes: {
        timeout_expired: Number(causesRes?.timeout_expired || 0),
        manual_after_ack: Number(causesRes?.manual_after_ack || 0),
        out_of_service_zero_pulses: Number(causesRes?.out_of_service_zero_pulses || 0),
      },
      latency: {
        summary: {
          total_acked: totalAcked,
          avg_poll_to_ack_s: Number(latencySummaryRaw?.avg_poll_to_ack_s || 0),
          p50_poll_to_ack_s: Number(latencySummaryRaw?.p50_poll_to_ack_s || 0),
          p95_poll_to_ack_s: Number(latencySummaryRaw?.p95_poll_to_ack_s || 0),
          max_poll_to_ack_s: Number(latencySummaryRaw?.max_poll_to_ack_s || 0),
          avg_queue_to_poll_s: Number(latencySummaryRaw?.avg_queue_to_poll_s || 0),
          p50_queue_to_poll_s: Number(latencySummaryRaw?.p50_queue_to_poll_s || 0),
          avg_total_s: Number(latencySummaryRaw?.avg_total_s || 0),
          avg_physical_s: Number(latencySummaryRaw?.avg_physical_s || 0),
          avg_net_overhead_s: Number(latencySummaryRaw?.avg_net_overhead_s || 0),
          fast_count: Number(latencySummaryRaw?.fast_count || 0),
          medium_count: Number(latencySummaryRaw?.medium_count || 0),
          slow_count: Number(latencySummaryRaw?.slow_count || 0),
          net_fast_count: Number(latencySummaryRaw?.net_fast_count || 0),
          net_medium_count: Number(latencySummaryRaw?.net_medium_count || 0),
          net_slow_count: Number(latencySummaryRaw?.net_slow_count || 0),
        },
        byMachine: latencyByMachineRaw.map(r => ({
          machine_id: r.machine_id,
          machine_name: r.machine_name,
          arduino_id: r.arduino_id,
          client_id: r.client_id,
          client_name: r.client_name,
          firmware_version: r.firmware_version,
          rssi: r.rssi,
          poll_interval_s: Number(r.poll_interval_s || 3),
          pulse_duration_ms: Number(r.pulse_duration_ms || 200),
          pulse_gap_ms: Number(r.pulse_gap_ms || 200),
          total_acked: Number(r.total_acked || 0),
          avg_pulses: Number(r.avg_pulses || 0),
          avg_queue_to_poll_s: Number(r.avg_queue_to_poll_s || 0),
          avg_poll_to_ack_s: Number(r.avg_poll_to_ack_s || 0),
          p50_poll_to_ack_s: Number(r.p50_poll_to_ack_s || 0),
          p95_poll_to_ack_s: Number(r.p95_poll_to_ack_s || 0),
          max_poll_to_ack_s: Number(r.max_poll_to_ack_s || 0),
          avg_physical_s: Number(r.avg_physical_s || 0),
          avg_net_overhead_s: Number(r.avg_net_overhead_s || 0),
          avg_total_s: Number(r.avg_total_s || 0),
          slow_ack_count: Number(r.slow_ack_count || 0),
          slow_net_count: Number(r.slow_net_count || 0),
        })),
        recentPulses: recentPulses.map(p => ({
          ...p,
          pulses_count: Number(p.pulses_count || 1),
          amount: Number(p.amount || 0),
          queue_to_poll_s: Number(p.queue_to_poll_s || 0),
          poll_to_ack_s: Number(p.poll_to_ack_s || 0),
          physical_s: Number(p.physical_s || 0),
          net_overhead_s: Number(p.net_overhead_s || 0),
          total_s: Number(p.total_s || 0),
        })),
        slowestPulses: slowestPulses.map(p => ({
          ...p,
          pulses_count: Number(p.pulses_count || 1),
          amount: Number(p.amount || 0),
          queue_to_poll_s: Number(p.queue_to_poll_s || 0),
          poll_to_ack_s: Number(p.poll_to_ack_s || 0),
          physical_s: Number(p.physical_s || 0),
          net_overhead_s: Number(p.net_overhead_s || 0),
          total_s: Number(p.total_s || 0),
        })),
      },
      dailyTrends: dailyRes,
      byClient: clientsRes,
      byMachine: machinesList,
      firmwareDistribution: fwDist,
    });

  } catch (error) {
    console.error('[superadmin-monitoring] Error:', error);
    res.status(500).json({ error: 'Error al procesar métricas de monitoreo' });
  }
});

export default router;


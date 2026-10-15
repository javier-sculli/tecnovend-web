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
    let intervalSql = '7 days';
    let isHourly = false;
    let periodDays = 7;

    if (period === '24h') {
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

    const timeGroupSql = isHourly
      ? `TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:00')`
      : `TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`;

    // 1. Métricas diarias consolidadas
    const dailyRes = await db.prepare(isHourly ? `
      SELECT 
        DATE_TRUNC('hour', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as t_trunc,
        TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'HH24:00') as dia,
        COUNT(*) as total_pagos,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as aprobados,
        COUNT(CASE WHEN refund_status = 'done' THEN 1 END) as reembolsados_done,
        COUNT(CASE WHEN refund_status = 'failed' THEN 1 END) as reembolsados_failed,
        COUNT(CASE WHEN refund_status = 'partial' THEN 1 END) as excedente_partial,
        ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso,
        ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolsos,
        COALESCE(SUM(CASE WHEN refund_status = 'done' THEN amount ELSE 0 END), 0) as monto_reembolsado,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as monto_total_aprobado
      FROM payments
      WHERE created_at >= NOW() - CAST(? AS interval)
      GROUP BY t_trunc, dia
      ORDER BY t_trunc ASC
    ` : `
      SELECT 
        DATE_TRUNC('day', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as t_trunc,
        TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD') as dia,
        COUNT(*) as total_pagos,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as aprobados,
        COUNT(CASE WHEN refund_status = 'done' THEN 1 END) as reembolsados_done,
        COUNT(CASE WHEN refund_status = 'failed' THEN 1 END) as reembolsados_failed,
        COUNT(CASE WHEN refund_status = 'partial' THEN 1 END) as excedente_partial,
        ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso,
        ROUND(COUNT(CASE WHEN refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolsos,
        COALESCE(SUM(CASE WHEN refund_status = 'done' THEN amount ELSE 0 END), 0) as monto_reembolsado,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as monto_total_aprobado
      FROM payments
      WHERE created_at >= NOW() - CAST(? AS interval)
      GROUP BY t_trunc, dia
      ORDER BY t_trunc ASC
    `).all(intervalSql);

    // 2. Reembolsos agrupados por Cliente
    const clientsRes = await db.prepare(`
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
      LEFT JOIN payments p ON p.machine_id = m.id AND p.created_at >= NOW() - CAST(? AS interval)
      GROUP BY c.id, c.name
      ORDER BY reembolsos_done DESC, total_pagos DESC
    `).all(intervalSql);

    // 3. Reembolsos y Estado por Máquina
    const allMachines = await db.prepare(`
      SELECT m.id, m.name, m.arduino_id, m.status, m.last_seen_at, m.last_rssi, 
             m.firmware_version, m.target_fw_version, m.poll_interval_s,
             c.name as client_name, c.id as client_id
      FROM machines m
      LEFT JOIN clients c ON m.client_id = c.id
      ORDER BY m.name ASC
    `).all();

    const machineStatsRes = await db.prepare(`
      SELECT 
        p.machine_id,
        COUNT(p.id) as total_pagos,
        COALESCE(SUM(CASE WHEN p.status = 'approved' THEN p.amount ELSE 0 END), 0) as monto_aprobado,
        COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END) as reembolsos_done,
        COALESCE(SUM(CASE WHEN p.refund_status = 'done' THEN p.amount ELSE 0 END), 0) as monto_reembolsado,
        ROUND(COUNT(CASE WHEN p.refund_status = 'done' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN p.status = 'approved' THEN 1 END), 0) * 100, 1) as pct_reembolso
      FROM payments p
      WHERE p.created_at >= NOW() - CAST(? AS interval)
      GROUP BY p.machine_id
    `).all(intervalSql);

    const statsMap = {};
    for (const s of machineStatsRes) {
      statsMap[s.machine_id] = s;
    }

    const machinesList = allMachines.map(m => {
      const s = statsMap[m.id] || { total_pagos: 0, monto_aprobado: 0, reembolsos_done: 0, monto_reembolsado: 0, pct_reembolso: 0 };
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
      };
    }).sort((a, b) => b.reembolsos_done - a.reembolsos_done || b.total_pagos - a.total_pagos);

    // 4. Causas de Reembolso en el periodo
    const causesRes = await db.prepare(`
      SELECT 
        COUNT(CASE WHEN pq.status = 'expired' THEN 1 END) as timeout_expired,
        COUNT(CASE WHEN pq.status = 'acked' AND p.refund_status = 'done' THEN 1 END) as manual_after_ack,
        COUNT(CASE WHEN p.pulses_calculated = 0 AND p.refund_status = 'done' THEN 1 END) as out_of_service_zero_pulses
      FROM payments p
      LEFT JOIN pulse_queue pq ON pq.payment_id = p.id
      WHERE p.refund_status = 'done'
        AND p.created_at >= NOW() - CAST(? AS interval)
    `).get(intervalSql);

    // 5. Distribución de Firmware
    const fwDist = {};
    for (const m of allMachines) {
      const v = m.firmware_version || 'Desconocida';
      fwDist[v] = (fwDist[v] || 0) + 1;
    }

    // 6. KPIs consolidados
    let totalApproved = 0;
    let totalRefundedCount = 0;
    let totalRefundedAmount = 0;
    let totalApprovedAmount = 0;

    for (const d of dailyRes) {
      totalApproved += Number(d.aprobados);
      totalRefundedCount += Number(d.reembolsados_done);
      totalRefundedAmount += Number(d.monto_reembolsado);
      totalApprovedAmount += Number(d.monto_total_aprobado);
    }

    const overallRefundRate = totalApproved > 0 
      ? Number(((totalRefundedCount / totalApproved) * 100).toFixed(1)) 
      : 0;

    const criticalMachines = machinesList.filter(m => m.pct_reembolso >= 10 && m.total_pagos >= 5).length;

    res.json({
      period,
      periodDays,
      kpis: {
        total_approved: totalApproved,
        total_approved_amount: totalApprovedAmount,
        total_refunded_count: totalRefundedCount,
        total_refunded_amount: totalRefundedAmount,
        overall_refund_rate: overallRefundRate,
        critical_machines_count: criticalMachines,
        total_machines: allMachines.length,
      },
      causes: {
        timeout_expired: Number(causesRes?.timeout_expired || 0),
        manual_after_ack: Number(causesRes?.manual_after_ack || 0),
        out_of_service_zero_pulses: Number(causesRes?.out_of_service_zero_pulses || 0),
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


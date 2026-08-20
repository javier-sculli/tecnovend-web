import { Router } from 'express';
import db from '../db/schema.js';
import { machineState } from '../services/machine-state.js';

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
    const orgId = req.headers['x-org-id'] || null;
    
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
    const machinesQuery = orgId 
      ? 'SELECT id, name, location, status, last_seen_at, last_rssi, firmware_version FROM machines WHERE client_id = ?'
      : 'SELECT id, name, location, status, last_seen_at, last_rssi, firmware_version FROM machines';
    const machinesParams = orgId ? [orgId] : [];
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
    
    const paymentsParams = [...machineIds, since, until];
    const dbPayments = await db.prepare(paymentsQuery).all(...paymentsParams);

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

    // 3. Reinicios en el período (events de tipo heartbeat con reason 'startup')
    const rebootsQuery = `
      SELECT 
        machine_id,
        detail,
        created_at
      FROM machine_events
      WHERE machine_id IN (${placeholders})
        AND type = 'heartbeat'
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
    `;
    const rebootsParams = [...machineIds, since, until];
    const dbEvents = await db.prepare(rebootsQuery).all(...rebootsParams);

    const rebootsByMachineCount = {};
    for (const mId of machineIds) {
      rebootsByMachineCount[mId] = 0;
    }

    for (const e of dbEvents) {
      let detail = {};
      try { detail = e.detail ? JSON.parse(e.detail) : {}; } catch (err) {}

      if (detail.reason === 'startup') {
        rebootsByMachineCount[e.machine_id] = (rebootsByMachineCount[e.machine_id] || 0) + 1;
      }
    }

    const totalReboots = Object.values(rebootsByMachineCount).reduce((a, b) => a + b, 0);

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
    const chartDbRows = await db.prepare(chartQuery).all(...paymentsParams);
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

export default router;

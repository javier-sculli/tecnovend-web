import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { apiFetch } from '../api.js';
import { useAuth } from '../auth.jsx';

/* ---------- Helpers de Formato ---------- */
const ars = (n) => "$" + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 }) + " ARS";
const num = (n) => Number(n || 0).toLocaleString("es-AR");

const timeAgo = (ts) => {
  if (!ts) return 'nunca';
  const time = new Date(ts).getTime();
  if (isNaN(time)) return 'nunca';
  const ms = Math.max(0, Date.now() - time);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
};

const getRssiBadge = (rssi) => {
  if (rssi == null || rssi === 0) return { label: 'Sin señal', cls: 'badge-off' };
  if (rssi >= -65) return { label: `${rssi} dBm (Excelente)`, cls: 'badge-ok' };
  if (rssi >= -75) return { label: `${rssi} dBm (Aceptable)`, cls: 'badge-warn' };
  return { label: `${rssi} dBm (Débil / Inestable)`, cls: 'badge-bad' };
};

/* ============================================================
   Componente Gráfico de Tendencia Diaria (SVG Interactivo)
   ============================================================ */
function DailyTrendsChart({ trends }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!trends || trends.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        No hay datos de tendencias para el período seleccionado.
      </div>
    );
  }

  const W = 900;
  const H = 220;
  const padL = 42;
  const padR = 48;
  const padT = 25;
  const padB = 35;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const rawMaxTotal = Math.max(0, ...trends.map(t => Number(t.aprobados || 0)));
  const maxTotal = Math.max(Math.ceil(rawMaxTotal / 10) * 10, 10);

  const rawMaxPct = Math.max(0, ...trends.map(t => Number(t.pct_reembolso ?? t.pct_reembolsos ?? 0)));
  const maxPct = Math.max(Math.ceil(rawMaxPct / 5) * 5, 15);

  const stepX = chartW / Math.max(trends.length, 1);

  return (
    <div className="card" style={{ padding: '18px 20px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-1)' }}>Evolución: Ventas vs Reembolsos</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Barras: volumen de transacciones (Eje izq.) · Línea naranja: tasa de reembolso % (Eje der.)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--line-2)' }} /> Aprobados
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--bad)' }} /> Reembolsados
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 3, borderRadius: 1.5, background: 'var(--brand)' }} /> Tasa Reembolso (%)
          </span>
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* Líneas de cuadrícula horizontales y Ejes Y */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = padT + chartH * (1 - ratio);
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" strokeDasharray={ratio === 0 ? "none" : "3 3"} />
                {/* Eje izquierdo: Cantidad de Ventas */}
                <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">
                  {Math.round(maxTotal * ratio)}
                </text>
                {/* Eje derecho: Tasa % */}
                <text x={W - padR + 8} y={y + 3.5} textAnchor="start" fontSize="10" fill="var(--brand)" fontWeight="600">
                  {Math.round(maxPct * ratio)}%
                </text>
              </g>
            );
          })}

          {/* Barras de ventas y reembolsos */}
          {trends.map((d, i) => {
            const x = padL + i * stepX + stepX * 0.15;
            const barW = Math.max(stepX * 0.7, 5);
            const total = Number(d.aprobados || 0);
            const ref = Number(d.reembolsados_done || 0);

            const totalH = (total / maxTotal) * chartH;
            const refH = (ref / maxTotal) * chartH;

            const yTotal = padT + (chartH - totalH);
            const yRef = padT + (chartH - refH);

            const rawDia = String(d.dia || '');
            const diaLabel = rawDia.includes('-') ? rawDia.slice(5) : rawDia;
            const showLabel = trends.length <= 14 || (trends.length <= 24 ? i % 2 === 0 : i % 3 === 0);

            return (
              <g
                key={i}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Barra Aprobados (Fondo) */}
                <rect
                  x={x}
                  y={yTotal}
                  width={barW}
                  height={Math.max(totalH, 0)}
                  rx={2}
                  fill={hoverIndex === i ? "var(--ink-5)" : "var(--line)"}
                />
                {/* Barra Reembolsos (Frente) */}
                {ref > 0 && (
                  <rect
                    x={x}
                    y={yRef}
                    width={barW}
                    height={Math.max(refH, 2)}
                    rx={2}
                    fill="var(--bad)"
                    opacity={hoverIndex === i ? 1 : 0.85}
                  />
                )}
                {/* Etiqueta Eje X */}
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={H - padB + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill={hoverIndex === i ? "var(--ink-1)" : "var(--ink-3)"}
                    fontWeight={hoverIndex === i ? "600" : "normal"}
                  >
                    {diaLabel}
                  </text>
                )}
              </g>
            );
          })}

          {/* Línea de Tasa de Reembolso (%) */}
          {trends.length > 1 && (
            <path
              d={trends.map((d, i) => {
                const x = padL + i * stepX + stepX * 0.5;
                const pct = Number(d.pct_reembolso ?? d.pct_reembolsos ?? 0);
                const y = padT + chartH * (1 - Math.min(pct / maxPct, 1));
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Puntos y etiquetas en la línea */}
          {trends.map((d, i) => {
            const x = padL + i * stepX + stepX * 0.5;
            const pct = Number(d.pct_reembolso ?? d.pct_reembolsos ?? 0);
            const y = padT + chartH * (1 - Math.min(pct / maxPct, 1));
            const isHovered = hoverIndex === i;

            return (
              <g key={i} style={{ pointerEvents: 'none' }}>
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 5.5 : (pct > 0 ? 3.5 : 2.5)}
                  fill={isHovered || pct > 0 ? "var(--brand)" : "var(--panel)"}
                  stroke="var(--brand)"
                  strokeWidth="2"
                />
                {(isHovered || (pct > 0 && trends.length <= 14)) && (
                  <text
                    x={x}
                    y={y - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="var(--brand)"
                  >
                    {pct}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip flotante al hacer hover */}
      {hoverIndex !== null && trends[hoverIndex] && (
        <div
          style={{
            position: 'absolute',
            top: 18,
            right: 20,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            zIndex: 10,
            pointerEvents: 'none'
          }}
        >
          <div style={{ fontWeight: 600, borderBottom: '1px solid var(--line-2)', paddingBottom: 4, marginBottom: 4 }}>
            Fecha / Hora: {trends[hoverIndex].dia}
          </div>
          <div>Ventas aprobadas: <b>{num(trends[hoverIndex].aprobados)}</b> ({ars(trends[hoverIndex].monto_total_aprobado)})</div>
          <div style={{ color: 'var(--bad)' }}>Reembolsos: <b>{num(trends[hoverIndex].reembolsados_done)}</b> ({ars(trends[hoverIndex].monto_reembolsado)})</div>
          <div style={{ marginTop: 3, color: 'var(--brand)', fontWeight: 700 }}>
            Tasa de Reembolso: {Number(trends[hoverIndex].pct_reembolso ?? trends[hoverIndex].pct_reembolsos ?? 0)}%
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Página Principal de Monitoreo (Super Admin)
   ============================================================ */
export default function Monitoreo() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod] = useState('7d'); // '24h', '7d', '30d'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [searchMachine, setSearchMachine] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all', 'critical', 'refunds', 'offline'
  const [lastRefreshed, setLastRefreshed] = useState(Date.now());

  // Redirigir a /maquinas si el usuario no es Super Admin
  useEffect(() => {
    if (!isSuperAdmin) {
      navigate('/maquinas', { replace: true });
    }
  }, [isSuperAdmin, navigate]);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/dashboard/superadmin-monitoring?period=${period}`);
      setData(res);
      setLastRefreshed(Date.now());
    } catch (err) {
      console.error('[Monitoreo] Error al cargar datos:', err);
      setError(err.message || 'Error al conectar con la API de monitoreo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [period]);

  // Filtrado de máquinas
  const filteredMachines = useMemo(() => {
    if (!data?.byMachine) return [];
    let list = data.byMachine;

    if (searchMachine.trim()) {
      const q = searchMachine.toLowerCase();
      list = list.filter(m =>
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.arduino_id && m.arduino_id.toLowerCase().includes(q)) ||
        (m.client_name && m.client_name.toLowerCase().includes(q))
      );
    }

    if (filterMode === 'critical') {
      list = list.filter(m => m.pct_reembolso >= 10 && m.total_pagos >= 5);
    } else if (filterMode === 'refunds') {
      list = list.filter(m => m.reembolsos_done > 0);
    } else if (filterMode === 'offline') {
      list = list.filter(m => m.state === 'offline');
    }

    return list;
  }, [data?.byMachine, searchMachine, filterMode]);

  const kpis = data?.kpis || {
    total_approved: 0,
    total_approved_amount: 0,
    total_refunded_count: 0,
    total_refunded_amount: 0,
    overall_refund_rate: 0,
    critical_machines_count: 0,
    total_machines: 0,
  };

  const causes = data?.causes || {
    timeout_expired: 0,
    manual_after_ack: 0,
    out_of_service_zero_pulses: 0,
  };

  // Cobertura de firmware moderno
  const modernFwCount = useMemo(() => {
    if (!data?.firmwareDistribution) return 0;
    return Object.entries(data.firmwareDistribution)
      .filter(([ver]) => ver >= '0.0.25')
      .reduce((acc, [, count]) => acc + count, 0);
  }, [data?.firmwareDistribution]);

  const refundRateColor = kpis.overall_refund_rate > 8
    ? 'var(--bad)'
    : kpis.overall_refund_rate > 3
      ? 'var(--warn)'
      : 'var(--ok)';

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar crumbs={['Sistema', 'Monitoreo Red & Reembolsos']} />

        <div className="page" data-screen-label="Monitoreo">
          {/* Header con título y selector de período */}
          <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--brand)' }}>{Icon.pulse}</span> Monitoreo de Red & Reembolsos
              </h1>
              <div className="page-subtitle">
                Super Admin · Auditoría de sincronización de pulsos, causas de reembolsos y telemetría de hardware en tiempo real.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Botón selector de período */}
              <div style={{ display: 'inline-flex', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 2 }}>
                <button
                  onClick={() => setPeriod('24h')}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: 'none',
                    background: period === '24h' ? 'var(--brand)' : 'transparent',
                    color: period === '24h' ? '#fff' : 'var(--ink-2)',
                    cursor: 'pointer',
                    fontWeight: period === '24h' ? 600 : 400
                  }}
                >
                  24 Horas
                </button>
                <button
                  onClick={() => setPeriod('7d')}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: 'none',
                    background: period === '7d' ? 'var(--brand)' : 'transparent',
                    color: period === '7d' ? '#fff' : 'var(--ink-2)',
                    cursor: 'pointer',
                    fontWeight: period === '7d' ? 600 : 400
                  }}
                >
                  7 Días
                </button>
                <button
                  onClick={() => setPeriod('30d')}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: 'none',
                    background: period === '30d' ? 'var(--brand)' : 'transparent',
                    color: period === '30d' ? '#fff' : 'var(--ink-2)',
                    cursor: 'pointer',
                    fontWeight: period === '30d' ? 600 : 400
                  }}
                >
                  30 Días
                </button>
              </div>

              {/* Botón Refrescar */}
              <button
                className="btn"
                onClick={loadMetrics}
                disabled={loading}
                title="Actualizar datos"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ display: 'inline-block', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
                  {Icon.chev}
                </span>
                {loading ? 'Cargando…' : 'Refrescar'}
              </button>
            </div>
          </div>

          {error && (
            <div className="card" style={{ padding: 16, background: 'var(--bad-soft)', borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>
              <b>Error:</b> {error}
            </div>
          )}

          {/* Cards de Métricas Principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            {/* Tasa Global */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.pulse} Tasa de Reembolso Global
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: refundRateColor, letterSpacing: '-0.02em' }} className="mono">
                {kpis.overall_refund_rate}%
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                {kpis.overall_refund_rate > 8 ? '🚨 Tasa Crítica en el período' : kpis.overall_refund_rate > 3 ? '⚠️ Precaución' : '✅ En rango normal'}
              </div>
            </div>

            {/* Monto Reembolsado */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.card} Monto Reembolsado
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {ars(kpis.total_refunded_amount)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--bad)', marginTop: 4 }}>
                {num(kpis.total_refunded_count)} transacciones canceladas
              </div>
            </div>

            {/* Ventas Aprobadas */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.chart} Ventas Aprobadas
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {ars(kpis.total_approved_amount)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ok)', marginTop: 4 }}>
                {num(kpis.total_approved)} ventas efectivas
              </div>
            </div>

            {/* Máquinas Críticas */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.machine} Máquinas Críticas (&gt;10%)
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: kpis.critical_machines_count > 0 ? 'var(--bad)' : 'var(--ink-1)' }} className="mono">
                {kpis.critical_machines_count}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                de {kpis.total_machines} máquinas monitoreadas
              </div>
            </div>

            {/* Cobertura FW Nuevo */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.cog} Cobertura FW Anti-Rollback
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {modernFwCount} / {kpis.total_machines}
              </div>
              <div style={{ fontSize: 11.5, color: modernFwCount > 0 ? 'var(--ok)' : 'var(--ink-3)', marginTop: 4 }}>
                {modernFwCount > 0 ? 'v0.0.25/v0.0.26 con dedup activa' : 'Firmwares legacy en proceso OTA'}
              </div>
            </div>
          </div>

          {/* Gráfico de Tendencias Diarias */}
          <div style={{ marginBottom: 16 }}>
            <DailyTrendsChart trends={data?.dailyTrends || []} />
          </div>

          {/* Tarjetas de Desglose de Causas Raíz */}
          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 12 }}>
              Desglose de Causas de Reembolso en el Período
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
              <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 6, borderLeft: '3px solid var(--bad)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>
                  Timeout Expirado (Microcortes / Socket Drop)
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">
                  {causes.timeout_expired}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                  Pulso encolado pero no se recibió ACK antes de los 3 minutos de expiración. Mitigado a partir de v0.0.25 con re-entrega automática.
                </div>
              </div>

              <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 6, borderLeft: '3px solid var(--warn)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>
                  Cancelación Manual Posterior a ACK
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">
                  {causes.manual_after_ack}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                  La máquina acusó recibo del pulso correctamente, pero un operador o cliente solicitó la devolución manual posteriormente.
                </div>
              </div>

              <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 6, borderLeft: '3px solid var(--ink-4)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1)' }}>
                  Fuera de Servicio / Sin Pulsos
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">
                  {causes.out_of_service_zero_pulses}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                  Pagos recibidos cuando la máquina no contaba con pulsos calculados o estaba configurada temporalmente fuera de servicio.
                </div>
              </div>
            </div>
          </div>

          {/* Tabla 1: Reembolsos por Cliente */}
          <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
            <div className="card-head">
              <div>
                <div className="card-title">Reembolsos y Salud por Cliente</div>
                <div className="card-sub">Resumen consolidado de clientes operadores para detectar reclamos o descontento a tiempo</div>
              </div>
            </div>

            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Cliente</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquinas</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Ventas Aprobadas</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Reembolsos</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Monto Reembolsado</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Tasa (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {(!data?.byClient || data.byClient.length === 0) ? (
                    <tr>
                      <td colSpan="6" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)' }}>
                        No hay registros en el período
                      </td>
                    </tr>
                  ) : (
                    data.byClient.map((c, i) => {
                      const pct = Number(c.pct_reembolso || 0);
                      const isHigh = pct >= 8;
                      const isMedium = pct >= 3 && pct < 8;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--ink-1)' }}>
                            <Link to={`/clientes/${c.client_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                              {c.client_name}
                            </Link>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--ink-2)' }}>
                            {c.maquinas_activas}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--ink-1)' }} className="mono">
                            {num(c.total_pagos)}
                          </td>
                          <td style={{ padding: '12px 14px', color: c.reembolsos_done > 0 ? 'var(--bad)' : 'var(--ink-3)', fontWeight: c.reembolsos_done > 0 ? 600 : 400 }} className="mono">
                            {num(c.reembolsos_done)}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--ink-2)' }} className="mono">
                            {ars(c.monto_reembolsado)}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11.5,
                                fontWeight: 600,
                                background: isHigh ? 'var(--bad-soft)' : isMedium ? 'var(--warn-soft)' : 'var(--ok-soft)',
                                color: isHigh ? 'var(--bad)' : isMedium ? 'var(--warn)' : 'var(--ok)'
                              }}
                              className="mono"
                            >
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabla 2: Salud y Reembolsos por Máquina */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div className="card-title">Telemetría y Salud por Máquina</div>
                <div className="card-sub">Diagnóstico individual por placa física, versión de firmware y ratio de fallas</div>
              </div>

              {/* Filtros de Máquinas */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Buscar máquina, arduino o cliente…"
                  value={searchMachine}
                  onChange={e => setSearchMachine(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12.5,
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    background: 'var(--panel)',
                    color: 'var(--ink-1)',
                    width: 220
                  }}
                />

                <select
                  value={filterMode}
                  onChange={e => setFilterMode(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12.5,
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    background: 'var(--panel)',
                    color: 'var(--ink-1)',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">Todas ({data?.byMachine?.length || 0})</option>
                  <option value="critical">Críticas (&gt;10%)</option>
                  <option value="refunds">Con Reembolsos</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
            </div>

            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquina</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Cliente</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Firmware</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Estado & Conectividad</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Ventas</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Reembolsos</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Tasa (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMachines.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                        No se encontraron máquinas con los filtros actuales.
                      </td>
                    </tr>
                  ) : (
                    filteredMachines.map((m) => {
                      const pct = Number(m.pct_reembolso || 0);
                      const isCritical = pct >= 10 && m.total_pagos >= 5;
                      const isWarning = pct >= 5 && !isCritical;
                      const isFwModern = (m.firmware_version || '') >= '0.0.25';
                      const rssiInfo = getRssiBadge(m.rssi);

                      return (
                        <tr key={m.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <Link to={`/maquinas/${m.id}`} style={{ textDecoration: 'none', color: 'inherit', fontWeight: 600 }}>
                              {m.name}
                            </Link>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
                              {m.arduino_id}
                            </div>
                          </td>

                          <td style={{ padding: '12px 14px', color: 'var(--ink-2)' }}>
                            {m.client_name}
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  background: isFwModern ? 'var(--ok-soft)' : 'var(--tint)',
                                  color: isFwModern ? 'var(--ok)' : 'var(--ink-3)',
                                  fontWeight: 600
                                }}
                              >
                                v{m.firmware_version}
                              </span>
                              {m.target_fw_version && (
                                <span
                                  style={{
                                    padding: '2px 5px',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    background: 'var(--info-soft)',
                                    color: 'var(--info)'
                                  }}
                                  title={`Actualización pendiente a ${m.target_fw_version}`}
                                >
                                  OTA → v{m.target_fw_version}
                                </span>
                              )}
                            </div>
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: m.state === 'online' ? 'var(--ok)' : m.state === 'out_of_service' ? 'var(--warn)' : 'var(--bad)',
                                  display: 'inline-block'
                                }}
                              />
                              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                                {m.state === 'online' ? 'Online' : m.state === 'out_of_service' ? 'Fuera de servicio' : 'Desconectada'}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: 'var(--ink-4)',
                                  padding: '1px 5px',
                                  borderRadius: 3,
                                  background: 'var(--line-2)'
                                }}
                                title="Señal WiFi"
                              >
                                {m.rssi ? `${m.rssi} dBm` : '—'}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                              Visto: {timeAgo(m.last_seen_at)}
                            </div>
                          </td>

                          <td style={{ padding: '12px 14px', color: 'var(--ink-1)' }} className="mono">
                            {num(m.total_pagos)}
                            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                              {ars(m.monto_aprobado)}
                            </div>
                          </td>

                          <td style={{ padding: '12px 14px', color: m.reembolsos_done > 0 ? 'var(--bad)' : 'var(--ink-4)', fontWeight: m.reembolsos_done > 0 ? 600 : 400 }} className="mono">
                            {num(m.reembolsos_done)}
                            {m.monto_reembolsado > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--bad)' }}>
                                {ars(m.monto_reembolsado)}
                              </div>
                            )}
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                background: isCritical ? 'var(--bad-soft)' : isWarning ? 'var(--warn-soft)' : 'var(--ok-soft)',
                                color: isCritical ? 'var(--bad)' : isWarning ? 'var(--warn)' : 'var(--ok)'
                              }}
                              className="mono"
                            >
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

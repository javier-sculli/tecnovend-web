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
const sec = (n) => {
  if (n == null || isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v.toLocaleString("es-AR", { minimumFractionDigits: v < 10 ? 2 : 1, maximumFractionDigits: v < 10 ? 2 : 1 })}s`;
};

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

const getLatencyTone = (pollToAckS, netOverheadS) => {
  const net = Number(netOverheadS ?? pollToAckS ?? 0);
  if (net > 12 || Number(pollToAckS) > 35) {
    return { bg: 'var(--bad-soft)', fg: 'var(--bad)', label: 'Lenta / Reintento' };
  }
  if (net > 3.5 || Number(pollToAckS) > 15) {
    return { bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'Moderada' };
  }
  return { bg: 'var(--ok-soft)', fg: 'var(--ok)', label: 'Rápida' };
};

/* ============================================================
   Componente Gráfico de Tendencia Diaria / Horaria (SVG)
   ============================================================ */
function DailyTrendsChart({ trends, period }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!trends || trends.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        No hay datos de tendencias para el período seleccionado.
      </div>
    );
  }

  const W = 900;
  const H = 230;
  const padL = 42;
  const padR = 48;
  const padT = 28;
  const padB = 38;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const rawMaxTotal = Math.max(0, ...trends.map(t => Number(t.aprobados || 0)));
  const maxTotal = Math.max(Math.ceil(rawMaxTotal / 5) * 5, 10);

  const rawMaxPct = Math.max(0, ...trends.map(t => Number(t.pct_reembolso ?? t.pct_reembolsos ?? 0)));
  const maxPct = Math.max(Math.ceil(rawMaxPct / 5) * 5, 15);

  const stepX = chartW / Math.max(trends.length, 1);

  // Índice donde empieza "Hoy" cuando estamos en modo 24h
  const todayStartIndex = useMemo(() => {
    if (period !== '24h') return -1;
    const idx = trends.findIndex((t, i) => i > 0 && t.is_today && !trends[i - 1].is_today);
    return idx;
  }, [trends, period]);

  return (
    <div className="card" style={{ padding: '18px 20px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-1)' }}>
            Evolución: Ventas vs Reembolsos {period === '24h' ? '(Últimas 24 hs en hora Argentina)' : period === 'today' ? '(Hoy desde las 00:00 hs)' : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Barras: volumen de transacciones (Eje izq.) · Línea naranja: tasa de reembolso % (Eje der.)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, alignItems: 'center', flexWrap: 'wrap' }}>
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
                <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">
                  {Math.round(maxTotal * ratio)}
                </text>
                <text x={W - padR + 8} y={y + 3.5} textAnchor="start" fontSize="10" fill="var(--brand)" fontWeight="600">
                  {Math.round(maxPct * ratio)}%
                </text>
              </g>
            );
          })}

          {/* Divisor visual entre Ayer y Hoy en vista 24h */}
          {todayStartIndex > 0 && (() => {
            const divX = padL + todayStartIndex * stepX;
            return (
              <g>
                <line
                  x1={divX}
                  y1={padT - 8}
                  x2={divX}
                  y2={H - padB}
                  stroke="var(--ink-4)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                <text x={divX - 6} y={padT - 8} textAnchor="end" fontSize="9.5" fill="var(--ink-4)" fontWeight="600">
                  ← Ayer
                </text>
                <text x={divX + 6} y={padT - 8} textAnchor="start" fontSize="9.5" fill="var(--brand)" fontWeight="600">
                  Hoy (00:00) →
                </text>
              </g>
            );
          })()}

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
            const showLabel = trends.length <= 14 || (trends.length <= 25 ? i % 2 === 0 || i === trends.length - 1 : i % 3 === 0);

            return (
              <g
                key={i}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Zona interactiva invisible de columna completa para facilitar el hover */}
                <rect
                  x={padL + i * stepX}
                  y={padT}
                  width={stepX}
                  height={chartH}
                  fill="transparent"
                />
                {/* Barra Aprobados (Fondo) */}
                <rect
                  x={x}
                  y={yTotal}
                  width={barW}
                  height={Math.max(totalH, 0)}
                  rx={2}
                  fill={hoverIndex === i ? "var(--ink-4)" : (d.is_today && period === '24h' ? "var(--ink-5)" : "var(--line)")}
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
                    fontWeight={hoverIndex === i || i === trends.length - 1 ? "600" : "normal"}
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
              style={{ pointerEvents: 'none' }}
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
            {trends[hoverIndex].dia_full || trends[hoverIndex].dia}
          </div>
          <div>Ventas aprobadas: <b>{num(trends[hoverIndex].aprobados)}</b> ({ars(trends[hoverIndex].monto_total_aprobado)})</div>
          <div style={{ color: 'var(--bad)' }}>Reembolsos: <b>{num(trends[hoverIndex].reembolsados_done)}</b> ({ars(trends[hoverIndex].monto_reembolsado)})</div>
          <div style={{ marginTop: 3, color: 'var(--brand)', fontWeight: 700 }}>
            Tasa de Reembolso: {Number(trends[hoverIndex].pct_reembolso ?? trends[hoverIndex].pct_reembolsos ?? 0)}%
          </div>
          {trends[hoverIndex].acked_count > 0 && (
            <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px dashed var(--line)', color: 'var(--ink-2)', fontSize: 11.5 }}>
              Tiempo Poll → ACK prom.: <b>{sec(trends[hoverIndex].avg_poll_to_ack_s)}</b> (P50: {sec(trends[hoverIndex].p50_poll_to_ack_s)})
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Sección: Tiempos desde Poll hasta el ACK (Velocidad de Acreditación)
   ============================================================ */
function PollToAckSection({ latency, trends, onSelectMachine, activeMachineId }) {
  const [pulseTab, setPulseTab] = useState('recent'); // 'recent' | 'slowest'
  const [machineSearch, setMachineSearch] = useState('');

  const summary = latency?.summary || {
    total_acked: 0,
    avg_poll_to_ack_s: 0,
    p50_poll_to_ack_s: 0,
    p95_poll_to_ack_s: 0,
    max_poll_to_ack_s: 0,
    avg_queue_to_poll_s: 0,
    p50_queue_to_poll_s: 0,
    avg_total_s: 0,
    avg_physical_s: 0,
    avg_net_overhead_s: 0,
    fast_count: 0,
    medium_count: 0,
    slow_count: 0,
    net_fast_count: 0,
    net_medium_count: 0,
    net_slow_count: 0,
  };

  const totalAcked = Math.max(summary.total_acked, 0);
  const netFastPct = totalAcked > 0 ? Math.round((summary.net_fast_count / totalAcked) * 100) : 0;
  const fastPct = totalAcked > 0 ? Math.round((summary.fast_count / totalAcked) * 100) : 0;
  const mediumPct = totalAcked > 0 ? Math.round((summary.medium_count / totalAcked) * 100) : 0;
  const slowPct = totalAcked > 0 ? Math.round((summary.slow_count / totalAcked) * 100) : 0;

  const filteredByMachine = useMemo(() => {
    const list = latency?.byMachine || [];
    if (!machineSearch.trim()) return list;
    const q = machineSearch.toLowerCase();
    return list.filter(m =>
      (m.machine_name && m.machine_name.toLowerCase().includes(q)) ||
      (m.client_name && m.client_name.toLowerCase().includes(q)) ||
      (m.arduino_id && m.arduino_id.toLowerCase().includes(q))
    );
  }, [latency?.byMachine, machineSearch]);

  const pulsesList = pulseTab === 'slowest'
    ? (latency?.slowestPulses || [])
    : (latency?.recentPulses || []);

  const physSharePct = summary.avg_poll_to_ack_s > 0
    ? Math.min(100, Math.round((summary.avg_physical_s / summary.avg_poll_to_ack_s) * 100))
    : 0;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      {/* Encabezado de la sección */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--brand)', display: 'inline-flex' }}>{Icon.clock}</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink-1)' }}>
              Tiempos de Acreditación: desde Poll hasta ACK
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4, maxWidth: 780 }}>
            Auditoría de cuánto demora cada máquina en levantar el pago y confirmar los pulsos. Permite distinguir si la demora percibida se debe a <b>la duración física de los pulsos del relé</b> (ej. 24 pulsos × 0.5s = 12s) o a <b>demoras reales de red WiFi / reintentos</b>.
          </div>
        </div>

        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, color: 'var(--ink-2)' }}>
          <div><b>1. Espera de Poll (Pago → Poll):</b> Tiempo hasta que el Arduino consulta <code>/poll</code> (normal: 1s a 3.5s).</div>
          <div style={{ marginTop: 2 }}><b>2. Poll → ACK:</b> Tiempo que tarda en enviar los pulsos físicos al monedero + confirmar <code>/ack</code>.</div>
        </div>
      </div>

      {/* KPIs de Latencia Poll -> ACK */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 12, marginBottom: 18 }}>
        {/* KPI 1: Tiempo Poll -> ACK */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
            Tiempo Poll → ACK (Prom.)
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
            {sec(summary.avg_poll_to_ack_s)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }} className="mono">
            Mediana (P50): <b>{sec(summary.p50_poll_to_ack_s)}</b> · P95: <b>{sec(summary.p95_poll_to_ack_s)}</b>
          </div>
        </div>

        {/* KPI 2: Desglose Físico vs Red */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
            Desglose Poll → ACK (Relé vs Red)
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">{sec(summary.avg_physical_s)}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>relé físico</span>
            </div>
            <div>
              <span style={{ fontSize: 17, fontWeight: 700, color: summary.avg_net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)' }} className="mono">
                +{sec(summary.avg_net_overhead_s)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>red/ESP32</span>
            </div>
          </div>
          <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginTop: 8, display: 'flex' }}>
            <div style={{ width: `${physSharePct}%`, background: 'var(--ink-3)' }} title={`Relé físico: ${sec(summary.avg_physical_s)}`} />
            <div style={{ width: `${100 - physSharePct}%`, background: summary.avg_net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)' }} title={`Demora de red: ${sec(summary.avg_net_overhead_s)}`} />
          </div>
        </div>

        {/* KPI 3: Espera de Poll */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
            Espera hasta el Poll (Pago → Poll)
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, color: summary.avg_queue_to_poll_s > 10 ? 'var(--warn)' : 'var(--ink-1)' }} className="mono">
            {sec(summary.avg_queue_to_poll_s)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }} className="mono">
            Mediana (P50): <b>{sec(summary.p50_queue_to_poll_s)}</b> · Intervalo poll: 3s
          </div>
        </div>

        {/* KPI 4: Tiempo Total Pago -> ACK */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
            Tiempo Total (Pago → ACK)
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
            {sec(summary.avg_total_s)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Sobre <b>{num(totalAcked)}</b> acreditaciones confirmadas
          </div>
        </div>

        {/* KPI 5: Distribución por Tramos */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
            Distribución Poll → ACK
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--ok)', fontWeight: 600 }}>● ≤ 5s (Rápidas):</span>
              <span className="mono"><b>{num(summary.fast_count)}</b> ({fastPct}%)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--warn)', fontWeight: 600 }}>● 5s–15s (Multinivel/Pulsos):</span>
              <span className="mono"><b>{num(summary.medium_count)}</b> ({mediumPct}%)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--bad)', fontWeight: 600 }}>● &gt; 15s (Lentas / Termos):</span>
              <span className="mono"><b>{num(summary.slow_count)}</b> ({slowPct}%)</span>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, borderTop: '1px solid var(--line-2)', paddingTop: 3 }}>
            Sin demora de red (≤3s extra): <b>{netFastPct}%</b>
          </div>
        </div>
      </div>

      {/* Tabla 1 de la sección: Ranking de Tiempos Poll -> ACK por Máquina */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-1)' }}>
              Tiempos Poll → ACK por Máquina (Ordenado de más lenta a más rápida)
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              Compará cuánto demora cada máquina en tomar el poll, pulsar el relé y devolver el ACK
            </div>
          </div>
          <input
            type="text"
            placeholder="Filtrar máquina o cliente en esta tabla…"
            value={machineSearch}
            onChange={e => setMachineSearch(e.target.value)}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--panel)',
              color: 'var(--ink-1)',
              width: 230
            }}
          />
        </div>

        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Tiempos Poll a ACK por máquina" style={{ overflowX: 'auto', maxHeight: 380 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquina / Cliente</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>ACKs</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Pulsos / Venta</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Espera Poll (Pago → Poll)</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Poll → ACK (Prom / P50 / P95)</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Relé Físico vs Demora Red</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Total (Pago → ACK)</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Diagnóstico</th>
              </tr>
            </thead>
            <tbody>
              {filteredByMachine.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No hay acreditaciones registradas para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredByMachine.map((m) => {
                  const tone = getLatencyTone(m.avg_poll_to_ack_s, m.avg_net_overhead_s);
                  const isSelected = activeMachineId === m.machine_id;
                  return (
                    <tr
                      key={m.machine_id}
                      style={{
                        borderBottom: '1px solid var(--line-2)',
                        background: isSelected ? 'var(--tint)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Link to={`/maquinas/${m.machine_id}`} style={{ fontWeight: 600, color: 'var(--ink-1)', textDecoration: 'none' }}>
                            {m.machine_name}
                          </Link>
                          <button
                            onClick={() => onSelectMachine(isSelected ? '' : m.machine_id)}
                            title={isSelected ? "Quitar filtro de máquina" : "Filtrar todo el monitoreo por esta máquina"}
                            style={{
                              padding: '1px 6px',
                              fontSize: 10.5,
                              borderRadius: 4,
                              border: '1px solid var(--line)',
                              background: isSelected ? 'var(--brand)' : 'var(--bg)',
                              color: isSelected ? '#fff' : 'var(--ink-3)',
                              cursor: 'pointer'
                            }}
                          >
                            {isSelected ? 'Filtrando ✓' : 'Filtrar'}
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {m.client_name} · <span className="mono">{m.arduino_id}</span> {m.rssi ? `(${m.rssi} dBm)` : ''}
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        {num(m.total_acked)}
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        <b>{m.avg_pulses}</b> pulsos
                        <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                          {m.pulse_duration_ms}ms + {m.pulse_gap_ms}ms
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px', color: m.avg_queue_to_poll_s > 10 ? 'var(--bad)' : 'var(--ink-2)' }} className="mono">
                        <b>{sec(m.avg_queue_to_poll_s)}</b>
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontWeight: 700,
                            background: tone.bg,
                            color: tone.fg
                          }}
                        >
                          {sec(m.avg_poll_to_ack_s)}
                        </span>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
                          P50: {sec(m.p50_poll_to_ack_s)} · P95: {sec(m.p95_poll_to_ack_s)}
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        <div>Relé: <b>{sec(m.avg_physical_s)}</b></div>
                        <div style={{ fontSize: 11, color: m.avg_net_overhead_s > 8 ? 'var(--bad)' : 'var(--ink-3)' }}>
                          Red: <b>+{sec(m.avg_net_overhead_s)}</b>
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px', fontWeight: 600 }} className="mono">
                        {sec(m.avg_total_s)}
                      </td>

                      <td style={{ padding: '10px 12px', fontSize: 11.5 }}>
                        {m.avg_net_overhead_s > 12 ? (
                          <span style={{ color: 'var(--bad)', fontWeight: 600 }}>
                            ⚠️ Demora de red / reintentos ({m.slow_net_count} lentas)
                          </span>
                        ) : m.avg_physical_s >= 10 ? (
                          <span style={{ color: 'var(--ink-2)' }}>
                            ⏱️ Demora por pulsos físicos ({sec(m.avg_physical_s)} de relé)
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
                            ✅ Acreditación rápida
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla 2 de la sección: Auditoría de Transacciones Individuales (Poll -> ACK) */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-1)' }}>
              Detalle de Transacciones: Tiempos de Poll y ACK
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              Trazabilidad segundo a segundo de cada venta acreditada (Hora local Argentina)
            </div>
          </div>

          <div style={{ display: 'inline-flex', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 2 }}>
            <button
              onClick={() => setPulseTab('recent')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: 'none',
                background: pulseTab === 'recent' ? 'var(--brand)' : 'transparent',
                color: pulseTab === 'recent' ? '#fff' : 'var(--ink-2)',
                cursor: 'pointer',
                fontWeight: pulseTab === 'recent' ? 600 : 400
              }}
            >
              Últimas 40 acreditaciones
            </button>
            <button
              onClick={() => setPulseTab('slowest')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: 'none',
                background: pulseTab === 'slowest' ? 'var(--bad)' : 'transparent',
                color: pulseTab === 'slowest' ? '#fff' : 'var(--ink-2)',
                cursor: 'pointer',
                fontWeight: pulseTab === 'slowest' ? 600 : 400
              }}
            >
              Top 40 más lentas del período
            </button>
          </div>
        </div>

        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Detalle de transacciones Poll a ACK" style={{ overflowX: 'auto', maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Pago (Hora AR)</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquina / Cliente</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Monto & Pulsos</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Hora Poll → Hora ACK</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Espera Poll</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Tiempo Poll → ACK</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Desglose (Relé + Red)</th>
                <th style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Total (Pago → ACK)</th>
              </tr>
            </thead>
            <tbody>
              {pulsesList.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No hay pulsos acreditados en este período.
                  </td>
                </tr>
              ) : (
                pulsesList.map((p) => {
                  const tone = getLatencyTone(p.poll_to_ack_s, p.net_overhead_s);
                  return (
                    <tr key={p.pulse_id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '9px 12px' }} className="mono">
                        <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{p.created_at_ar}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{p.pulse_id}</div>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <Link to={`/maquinas/${p.machine_id}`} style={{ fontWeight: 600, color: 'var(--ink-1)', textDecoration: 'none' }}>
                          {p.machine_name}
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.client_name}</div>
                      </td>
                      <td style={{ padding: '9px 12px' }} className="mono">
                        <div style={{ fontWeight: 600 }}>{p.amount ? ars(p.amount) : '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.pulses_count} {p.pulses_count === 1 ? 'pulso' : 'pulsos'}</div>
                      </td>
                      <td style={{ padding: '9px 12px' }} className="mono">
                        {p.delivered_at_ar} → <b>{p.acked_at_ar}</b>
                      </td>
                      <td style={{ padding: '9px 12px', color: p.queue_to_poll_s > 10 ? 'var(--bad)' : 'var(--ink-2)' }} className="mono">
                        {sec(p.queue_to_poll_s)}
                      </td>
                      <td style={{ padding: '9px 12px' }} className="mono">
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontWeight: 700,
                            background: tone.bg,
                            color: tone.fg
                          }}
                        >
                          {sec(p.poll_to_ack_s)}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11.5 }} className="mono">
                        <span>{sec(p.physical_s)} relé</span>
                        <span style={{ color: p.net_overhead_s > 10 ? 'var(--bad)' : 'var(--ink-3)', marginLeft: 6 }}>
                          +{sec(p.net_overhead_s)} red
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 600 }} className="mono">
                        {sec(p.total_s)}
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
  );
}

/* ============================================================
   Página Principal de Monitoreo (Super Admin)
   ============================================================ */
export default function Monitoreo() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod] = useState('7d'); // 'today', '24h', '7d', '30d'
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [searchMachine, setSearchMachine] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all', 'critical', 'refunds', 'offline'

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
      const params = new URLSearchParams({ period });
      if (selectedClientId) params.set('client_id', selectedClientId);
      if (selectedMachineId) params.set('machine_id', selectedMachineId);

      const res = await apiFetch(`/api/dashboard/superadmin-monitoring?${params.toString()}`);
      setData(res);
    } catch (err) {
      console.error('[Monitoreo] Error al cargar datos:', err);
      setError(err.message || 'Error al conectar con la API de monitoreo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [period, selectedClientId, selectedMachineId]);

  // Opciones de clientes y máquinas para los selectores superiores
  const clientOptions = data?.filterOptions?.clients || [];
  const machineOptions = useMemo(() => {
    const all = data?.filterOptions?.machines || [];
    if (!selectedClientId) return all;
    return all.filter(m => m.client_id === selectedClientId);
  }, [data?.filterOptions?.machines, selectedClientId]);

  const handleClientChange = (newClientId) => {
    setSelectedClientId(newClientId);
    if (newClientId && selectedMachineId) {
      const m = (data?.filterOptions?.machines || []).find(x => x.id === selectedMachineId);
      if (m && m.client_id !== newClientId) {
        setSelectedMachineId('');
      }
    }
  };

  // Filtrado local adicional en la tabla de máquinas
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

  const hasActiveFilter = Boolean(selectedClientId || selectedMachineId);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar crumbs={['Sistema', 'Monitoreo Red & Reembolsos']} />

        <div className="page" data-screen-label="Monitoreo">
          {/* Header con título y controles de filtro */}
          <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--brand)' }}>{Icon.pulse}</span> Monitoreo de Red, Tiempos Poll → ACK & Reembolsos
              </h1>
              <div className="page-subtitle">
                Super Admin · Auditoría de tiempos de acreditación (Poll a ACK), causas de reembolsos y telemetría por cliente y máquina.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Selector de Cliente */}
              <select
                value={selectedClientId}
                onChange={e => handleClientChange(e.target.value)}
                aria-label="Filtrar por cliente"
                style={{
                  padding: '6px 10px',
                  fontSize: 12.5,
                  border: selectedClientId ? '1.5px solid var(--brand)' : '1px solid var(--line)',
                  borderRadius: 6,
                  background: 'var(--panel)',
                  color: 'var(--ink-1)',
                  cursor: 'pointer',
                  fontWeight: selectedClientId ? 600 : 400,
                  maxWidth: 210
                }}
              >
                <option value="">Todos los clientes ({clientOptions.length})</option>
                {clientOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              {/* Selector de Máquina */}
              <select
                value={selectedMachineId}
                onChange={e => setSelectedMachineId(e.target.value)}
                aria-label="Filtrar por máquina"
                style={{
                  padding: '6px 10px',
                  fontSize: 12.5,
                  border: selectedMachineId ? '1.5px solid var(--brand)' : '1px solid var(--line)',
                  borderRadius: 6,
                  background: 'var(--panel)',
                  color: 'var(--ink-1)',
                  cursor: 'pointer',
                  fontWeight: selectedMachineId ? 600 : 400,
                  maxWidth: 230
                }}
              >
                <option value="">Todas las máquinas ({machineOptions.length})</option>
                {machineOptions.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.client_name})
                  </option>
                ))}
              </select>

              {hasActiveFilter && (
                <button
                  className="btn"
                  onClick={() => {
                    setSelectedClientId('');
                    setSelectedMachineId('');
                  }}
                  style={{ fontSize: 12, padding: '5px 10px', color: 'var(--bad)', borderColor: 'var(--bad)' }}
                >
                  ✕ Limpiar filtro
                </button>
              )}

              {/* Botón selector de período */}
              <div style={{ display: 'inline-flex', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 2 }}>
                {[
                  { id: 'today', label: 'Hoy' },
                  { id: '24h', label: '24 Horas' },
                  { id: '7d', label: '7 Días' },
                  { id: '30d', label: '30 Días' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: 'none',
                      background: period === p.id ? 'var(--brand)' : 'transparent',
                      color: period === p.id ? '#fff' : 'var(--ink-2)',
                      cursor: 'pointer',
                      fontWeight: period === p.id ? 600 : 400
                    }}
                  >
                    {p.label}
                  </button>
                ))}
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
                {Icon.pulse} Tasa de Reembolso
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

            {/* Tiempo Poll -> ACK Promedio */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {Icon.clock} Tiempo Poll → ACK Prom.
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {sec(data?.latency?.summary?.avg_poll_to_ack_s)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }} className="mono">
                Red: +{sec(data?.latency?.summary?.avg_net_overhead_s)} · Relé: {sec(data?.latency?.summary?.avg_physical_s)}
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

          {/* Gráfico de Tendencias Diarias / Horarias */}
          <div style={{ marginBottom: 16 }}>
            <DailyTrendsChart trends={data?.dailyTrends || []} period={period} />
          </div>

          {/* NUEVA SECCIÓN: Tiempos desde Poll hasta el ACK */}
          <PollToAckSection
            latency={data?.latency}
            trends={data?.dailyTrends || []}
            activeMachineId={selectedMachineId}
            onSelectMachine={(mId) => setSelectedMachineId(mId)}
          />

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
                  Pulso encolado pero no se recibió ACK antes de la expiración. Mitigado a partir de v0.0.25 con re-entrega automática.
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
                <div className="card-sub">Hacé clic en &quot;Filtrar&quot; para ver todo el tablero (gráfico, Poll→ACK y máquinas) de un cliente específico</div>
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
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {(!data?.byClient || data.byClient.length === 0) ? (
                    <tr>
                      <td colSpan="7" style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)' }}>
                        No hay registros en el período
                      </td>
                    </tr>
                  ) : (
                    data.byClient.map((c, i) => {
                      const pct = Number(c.pct_reembolso || 0);
                      const isHigh = pct >= 8;
                      const isMedium = pct >= 3 && pct < 8;
                      const isClientSelected = selectedClientId === c.client_id;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--line-2)', background: isClientSelected ? 'var(--tint)' : 'transparent' }}>
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
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              onClick={() => handleClientChange(isClientSelected ? '' : c.client_id)}
                              style={{
                                padding: '3px 9px',
                                fontSize: 11.5,
                                borderRadius: 4,
                                border: '1px solid var(--line)',
                                background: isClientSelected ? 'var(--brand)' : 'var(--panel)',
                                color: isClientSelected ? '#fff' : 'var(--ink-2)',
                                cursor: 'pointer',
                                fontWeight: isClientSelected ? 600 : 400
                              }}
                            >
                              {isClientSelected ? 'Filtrando ✓' : 'Filtrar cliente'}
                            </button>
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
                <div className="card-sub">Diagnóstico individual por placa física, versión de firmware, tiempo Poll → ACK y ratio de fallas</div>
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
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Poll → ACK Prom.</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Ventas</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Reembolsos</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--ink-3)' }}>Tasa (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMachines.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                        No se encontraron máquinas con los filtros actuales.
                      </td>
                    </tr>
                  ) : (
                    filteredMachines.map((m) => {
                      const pct = Number(m.pct_reembolso || 0);
                      const isCritical = pct >= 10 && m.total_pagos >= 5;
                      const isWarning = pct >= 5 && !isCritical;
                      const isFwModern = (m.firmware_version || '') >= '0.0.25';

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

                          <td style={{ padding: '12px 14px' }} className="mono">
                            {m.avg_poll_to_ack_s != null ? (
                              <>
                                <b>{sec(m.avg_poll_to_ack_s)}</b>
                                <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                                  Poll: {sec(m.avg_queue_to_poll_s)}
                                </div>
                              </>
                            ) : (
                              <span style={{ color: 'var(--ink-4)' }}>—</span>
                            )}
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

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
  return `${v.toLocaleString("es-AR", { minimumFractionDigits: v < 10 ? 1 : 1, maximumFractionDigits: 1 })}s`;
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

// Diagnóstico claro en 1 frase según las 3 etapas (Espera Poll, Pulsos Físicos, Red ACK)
function getDelayReason(queueToPollS, physicalS, netOverheadS, avgPulses) {
  const q = Number(queueToPollS || 0);
  const p = Number(physicalS || 0);
  const net = Number(netOverheadS || 0);
  const pulses = Number(avgPulses || 1);

  if (q === 0 && p === 0 && net === 0) {
    return { label: 'Sin ventas acreditadas', tone: 'neutral' };
  }

  // Priorizar problemas reales de conectividad (Reconexión en ACK o en Poll)
  if (net > 8 && q > 8) {
    return {
      label: `📡 Mala conexión (reconecta en Poll +${sec(q)} y en ACK +${sec(net)})`,
      tone: 'bad',
    };
  }
  if (net > 6) {
    return {
      label: `📡 Demora de red al confirmar ACK (+${sec(net)} de reconexión)`,
      tone: 'bad',
    };
  }
  if (q > 7) {
    return {
      label: `📡 Tardó en levantar el Poll (${sec(q)} reconectando antes de cobrar)`,
      tone: 'warn',
    };
  }
  if (p >= 20 && pulses <= 2) {
    return {
      label: `⏱️ Pulso largo configurado (${sec(p)} de relé continuo / termo)`,
      tone: 'info',
    };
  }
  if (p >= 8) {
    return {
      label: `⚙️ Demora física por cantidad de pulsos (${pulses} pulsos = ${sec(p)} de relé)`,
      tone: 'info',
    };
  }
  return {
    label: '✅ Acreditación rápida y conexión estable',
    tone: 'ok',
  };
}

const TONE_STYLES = {
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  bad: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  info: { bg: 'var(--tint)', fg: 'var(--ink-2)' },
  neutral: { bg: 'var(--bg)', fg: 'var(--ink-4)' },
};

/* ============================================================
   1. Gráfico Principal: Ventas vs Reembolsos (SVG)
   ============================================================ */
function DailyTrendsChart({ trends, period, causes }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const todayStartIndex = useMemo(() => {
    if (!trends || trends.length === 0 || period !== '24h') return -1;
    return trends.findIndex((t, i) => i > 0 && t.is_today && !trends[i - 1].is_today);
  }, [trends, period]);

  if (!trends || trends.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13, marginBottom: 16 }}>
        No hay datos de tendencias para el período seleccionado.
      </div>
    );
  }

  const W = 900;
  const H = 225;
  const padL = 42;
  const padR = 48;
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const rawMaxTotal = Math.max(0, ...trends.map(t => Number(t.aprobados || 0)));
  const maxTotal = Math.max(Math.ceil(rawMaxTotal / 5) * 5, 10);

  const rawMaxPct = Math.max(0, ...trends.map(t => Number(t.pct_reembolso ?? t.pct_reembolsos ?? 0)));
  const maxPct = Math.max(Math.ceil(rawMaxPct / 5) * 5, 15);

  const stepX = chartW / Math.max(trends.length, 1);

  return (
    <div className="card" style={{ padding: '18px 20px', position: 'relative', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink-1)' }}>
            1. Evolución de Ventas vs Reembolsos {period === '24h' ? '(Últimas 24 hs · Hora Argentina)' : period === 'today' ? '(Hoy desde las 00:00 hs)' : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Barras grises: ventas aprobadas · Barras rojas: reembolsos · Línea naranja: % de reembolso
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--ink-5)' }} /> Ventas Aprobadas
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--bad)' }} /> Reembolsos
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 3, borderRadius: 1.5, background: 'var(--brand)' }} /> Tasa Reembolso (%)
          </span>
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
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

          {todayStartIndex > 0 && (() => {
            const divX = padL + todayStartIndex * stepX;
            return (
              <g>
                <line x1={divX} y1={padT - 8} x2={divX} y2={H - padB} stroke="var(--ink-4)" strokeWidth="1" strokeDasharray="4 3" />
                <text x={divX - 6} y={padT - 8} textAnchor="end" fontSize="9.5" fill="var(--ink-4)" fontWeight="600">
                  ← Ayer
                </text>
                <text x={divX + 6} y={padT - 8} textAnchor="start" fontSize="9.5" fill="var(--brand)" fontWeight="600">
                  Hoy (00:00) →
                </text>
              </g>
            );
          })()}

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
                <rect x={padL + i * stepX} y={padT} width={stepX} height={chartH} fill="transparent" />
                <rect
                  x={x}
                  y={yTotal}
                  width={barW}
                  height={Math.max(totalH, 0)}
                  rx={2}
                  fill={hoverIndex === i ? "var(--ink-4)" : (d.is_today && period === '24h' ? "var(--ink-5)" : "var(--line)")}
                />
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
                  <text x={x} y={y - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--brand)">
                    {pct}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip flotante */}
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
        </div>
      )}

      {/* Tira compacta de Causas de Reembolso al pie del gráfico */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-2)' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>Causas de reembolso en el período:</span>
        <span>
          <b style={{ color: 'var(--bad)' }} className="mono">{num(causes.timeout_expired)}</b> por Timeout sin ACK (corte de red)
        </span>
        <span>·</span>
        <span>
          <b style={{ color: 'var(--warn)' }} className="mono">{num(causes.manual_after_ack)}</b> devoluciones manuales post-ACK
        </span>
        <span>·</span>
        <span>
          <b style={{ color: 'var(--ink-2)' }} className="mono">{num(causes.out_of_service_zero_pulses)}</b> por monto menor a 1 pulso / fuera de servicio
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   2A. Gráfico de Evolución Temporal de Demoras + Línea de Tiempo por Máquina
   ============================================================ */
function LatencyTrendsChart({ trends, period, byMachine }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [chartMachineId, setChartMachineId] = useState('ALL');
  const [showAllMachinesMatrix, setShowAllMachinesMatrix] = useState(false);

  // Lista de máquinas con ventas acreditadas en el período, ordenadas por mayor demora
  const activeMachines = useMemo(() => {
    return (byMachine || [])
      .filter(m => Number(m.total_acked || 0) > 0)
      .sort((a, b) => Number(b.avg_total_s || 0) - Number(a.avg_total_s || 0));
  }, [byMachine]);

  // Si la máquina elegida en las píldoras del gráfico ya no está en el alcance, volver a ALL
  useEffect(() => {
    if (chartMachineId !== 'ALL' && !activeMachines.some(m => String(m.id) === String(chartMachineId))) {
      setChartMachineId('ALL');
    }
  }, [activeMachines, chartMachineId]);

  // Serie temporal adaptada según si se está viendo "Todas" o una máquina puntual
  const series = useMemo(() => {
    if (!trends || trends.length === 0) return [];
    return trends.map(d => {
      if (chartMachineId === 'ALL') {
        const pollS = Number(d.avg_queue_to_poll_s || 0);
        const physS = Number(d.avg_physical_s || 0);
        const netS = Number(d.avg_net_overhead_s || 0);
        const totalS = Number(d.avg_total_s || (pollS + physS + netS) || 0);
        return {
          ...d,
          cur_acked: Number(d.acked_count || 0),
          cur_poll_s: pollS,
          cur_phys_s: physS,
          cur_net_s: netS,
          cur_total_s: totalS,
          cur_max_s: Number(d.max_total_s || totalS),
        };
      } else {
        const mEntry = (d.by_machine || []).find(m => String(m.machine_id) === String(chartMachineId));
        if (!mEntry) {
          return {
            ...d,
            cur_acked: 0,
            cur_poll_s: 0,
            cur_phys_s: 0,
            cur_net_s: 0,
            cur_total_s: 0,
            cur_max_s: 0,
          };
        }
        return {
          ...d,
          cur_acked: Number(mEntry.acked_count || 0),
          cur_poll_s: Number(mEntry.avg_queue_to_poll_s || 0),
          cur_phys_s: Number(mEntry.avg_physical_s || 0),
          cur_net_s: Number(mEntry.avg_net_overhead_s || 0),
          cur_total_s: Number(mEntry.avg_total_s || 0),
          cur_max_s: Number(mEntry.max_total_s || 0),
        };
      }
    });
  }, [trends, chartMachineId]);

  if (!series || series.length === 0) return null;

  const isHourly = period === 'today' || period === '24h';
  const periodLabel = period === 'today' ? 'Hoy (hora a hora)' : period === '24h' ? 'Últimas 24hs (hora a hora)' : `Últimos ${trends.length} días`;

  const W = 820;
  const H = 195;
  const padL = 42;
  const padR = 24;
  const padT = 22;
  const padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const maxSecRaw = Math.max(...series.map(d => d.cur_total_s), 12);
  const maxSec = Math.ceil(maxSecRaw / 5) * 5;
  const stepX = chartW / Math.max(series.length, 1);
  const barW = Math.min(Math.max(stepX * 0.56, 8), 34);

  // Línea de referencia de 10s
  const refSec = 10;
  const refY = padT + chartH * (1 - Math.min(refSec / maxSec, 1));

  const visibleMachinesMatrix = showAllMachinesMatrix ? activeMachines : activeMachines.slice(0, 8);

  return (
    <div
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 16,
        marginBottom: 18,
        position: 'relative',
      }}
    >
      {/* Encabezado del gráfico temporal + Píldoras para aislar máquina */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Evolución Temporal de Tiempos ({periodLabel})
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
            Barras apiladas con las 3 etapas a lo largo del tiempo. Tocá cualquier máquina para ver su curva individual o mirá el semáforo horario abajo.
          </div>
        </div>

        {/* Leyenda de los 3 colores (coinciden con las cards de arriba) */}
        <div style={{ display: 'flex', gap: 12, fontSize: 11.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b' }} />
            1. Espera Poll
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#64748b' }} />
            2A. Pulsos Físicos
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444' }} />
            2B. Red / Reconexión ACK
          </span>
        </div>
      </div>

      {/* Píldoras rápidas de máquinas para filtrar las barras en 1 clic */}
      {activeMachines.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginRight: 2 }}>Ver curva de:</span>
          <button
            onClick={() => setChartMachineId('ALL')}
            style={{
              padding: '3px 9px',
              fontSize: 11.5,
              borderRadius: 999,
              border: chartMachineId === 'ALL' ? '1.5px solid var(--brand)' : '1px solid var(--line)',
              background: chartMachineId === 'ALL' ? 'var(--brand)' : 'var(--panel)',
              color: chartMachineId === 'ALL' ? '#fff' : 'var(--ink-2)',
              fontWeight: chartMachineId === 'ALL' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            Todas (Promedio)
          </button>
          {activeMachines.slice(0, 10).map(m => {
            const isSelected = String(chartMachineId) === String(m.id);
            const dotColor = m.avg_total_s > 15 ? 'var(--bad)' : m.avg_total_s > 8 ? 'var(--warn)' : 'var(--ok)';
            return (
              <button
                key={m.id}
                onClick={() => setChartMachineId(isSelected ? 'ALL' : String(m.id))}
                style={{
                  padding: '3px 9px',
                  fontSize: 11.5,
                  borderRadius: 999,
                  border: isSelected ? '1.5px solid var(--brand)' : '1px solid var(--line)',
                  background: isSelected ? 'var(--brand)' : 'var(--panel)',
                  color: isSelected ? '#fff' : 'var(--ink-1)',
                  fontWeight: isSelected ? 600 : 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isSelected ? '#fff' : dotColor }} />
                <span>{m.name}</span>
                <span className="mono" style={{ opacity: 0.85, fontSize: 11 }}>({sec(m.avg_total_s)})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* SVG de Barras Apiladas en el Tiempo */}
      <div style={{ width: '100%', overflowX: 'auto', background: 'var(--panel)', borderRadius: 6, border: '1px solid var(--line-2)', padding: '6px 4px 2px 4px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 580, height: 'auto', display: 'block' }}>
          {/* Grilla horizontal (segundos) */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
            const y = padT + chartH * (1 - t);
            const valSec = Math.round(maxSec * t);
            return (
              <g key={idx}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line-2)" strokeDasharray="3 3" />
                <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)" className="mono">
                  {valSec}s
                </text>
              </g>
            );
          })}

          {/* Línea de referencia 10s */}
          {maxSec >= 12 && (
            <g>
              <line x1={padL} y1={refY} x2={W - padR} y2={refY} stroke="var(--warn)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
              <text x={W - padR - 2} y={refY - 4} textAnchor="end" fontSize="9.5" fill="var(--warn)" fontWeight="600">
                Umbral alerta (10s)
              </text>
            </g>
          )}

          {/* Barras apiladas por hora / día */}
          {series.map((d, i) => {
            const xCenter = padL + i * stepX + stepX * 0.5;
            const barX = xCenter - barW / 2;

            const pollH = (d.cur_poll_s / maxSec) * chartH;
            const physH = (d.cur_phys_s / maxSec) * chartH;
            const netH = (d.cur_net_s / maxSec) * chartH;
            const totalH = pollH + physH + netH;

            const yPoll = padT + chartH - pollH;
            const yPhys = yPoll - physH;
            const yNet = yPhys - netH;

            const isHovered = hoverIndex === i;
            const showEvery = series.length > 20 ? 3 : series.length > 12 ? 2 : 1;
            const showLabel = i % showEvery === 0 || i === series.length - 1;

            const totalColor = d.cur_total_s > 15 ? 'var(--bad)' : d.cur_total_s > 8 ? 'var(--warn)' : 'var(--ok)';

            return (
              <g
                key={d.bucket_key || i}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={padL + i * stepX}
                  y={padT}
                  width={stepX}
                  height={chartH}
                  fill={isHovered ? 'var(--line-2)' : 'transparent'}
                  opacity={0.45}
                />

                {d.cur_acked > 0 && (
                  <>
                    {/* 1. Espera de Poll (abajo, ámbar) */}
                    {pollH > 0 && (
                      <rect x={barX} y={yPoll} width={barW} height={Math.max(pollH, 1.5)} fill="#f59e0b" rx={1.5} />
                    )}
                    {/* 2A. Pulsos físicos (medio, gris azulado) */}
                    {physH > 0 && (
                      <rect x={barX} y={yPhys} width={barW} height={Math.max(physH, 1.5)} fill="#64748b" rx={1.5} />
                    )}
                    {/* 2B. Red / Reconexión ACK (arriba, rojo) */}
                    {netH > 0 && (
                      <rect x={barX} y={yNet} width={barW} height={Math.max(netH, 1.5)} fill="#ef4444" rx={1.5} />
                    )}

                    {/* Etiqueta de segundos arriba de la barra */}
                    {(isHovered || series.length <= 16 || d.cur_total_s > 10) && (
                      <text
                        x={xCenter}
                        y={Math.max(padT + 10, padT + chartH - totalH - 5)}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="700"
                        fill={totalColor}
                        className="mono"
                      >
                        {d.cur_total_s.toFixed(1)}s
                      </text>
                    )}
                  </>
                )}

                {showLabel && (
                  <text
                    x={xCenter}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight={d.is_today && !isHourly ? '700' : '500'}
                    fill={d.is_today && !isHourly ? 'var(--brand)' : 'var(--ink-3)'}
                    className="mono"
                  >
                    {d.dia}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip flotante con desglose de la hora/día y ranking de máquinas en ese bloque */}
      {hoverIndex !== null && series[hoverIndex] && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 16,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 11.5,
            zIndex: 20,
            pointerEvents: 'none',
            minWidth: 230,
          }}
        >
          <div style={{ fontWeight: 700, borderBottom: '1px solid var(--line-2)', paddingBottom: 4, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>{series[hoverIndex].dia_full || series[hoverIndex].dia}</span>
            <span className="mono" style={{ color: 'var(--ink-3)' }}>{series[hoverIndex].cur_acked} ventas</span>
          </div>
          {series[hoverIndex].cur_acked === 0 ? (
            <div style={{ color: 'var(--ink-3)' }}>Sin ventas acreditadas en este bloque</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#d97706', fontWeight: 600 }}>1. Espera Poll:</span>
                <b className="mono">{sec(series[hoverIndex].cur_poll_s)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>2A. Pulsos Físicos:</span>
                <b className="mono">{sec(series[hoverIndex].cur_phys_s)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>2B. Red en ACK:</span>
                <b className="mono">+{sec(series[hoverIndex].cur_net_s)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px dashed var(--line)', fontWeight: 700 }}>
                <span>Total Promedio (Máx {sec(series[hoverIndex].cur_max_s)}):</span>
                <span className="mono">{sec(series[hoverIndex].cur_total_s)}</span>
              </div>

              {/* Si está viendo Todas, mostrar qué máquinas operaron en esa hora/día */}
              {chartMachineId === 'ALL' && series[hoverIndex].by_machine && series[hoverIndex].by_machine.length > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 3, textTransform: 'uppercase' }}>
                    Máquinas en este horario:
                  </div>
                  {series[hoverIndex].by_machine.slice(0, 5).map(m => {
                    const c = m.avg_total_s > 15 ? 'var(--bad)' : m.avg_total_s > 8 ? 'var(--warn)' : 'var(--ok)';
                    return (
                      <div key={m.machine_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, marginTop: 2 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 145 }}>
                          {m.machine_name} <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>({m.acked_count})</span>
                        </span>
                        <b className="mono" style={{ color: c }}>{sec(m.avg_total_s)}</b>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SEMÁFORO TEMPORAL POR MÁQUINA: Permite ver de un vistazo si una máquina sigue lenta ahora o fue algo puntual de antes */}
      {activeMachines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>
              Comparativa Temporal por Máquina (izquierda = antes → derecha = más reciente / ahora):
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--ink-3)' }}>
              <span><b style={{ color: 'var(--ok)' }}>● ≤8s</b> Rápido</span>
              <span><b style={{ color: 'var(--warn)' }}>● 8–15s</b> Lento</span>
              <span><b style={{ color: 'var(--bad)' }}>● &gt;15s</b> Demora alta</span>
            </div>
          </div>

          <div
            className="table-wrapper"
            tabIndex={0}
            role="region"
            aria-label="Evolución temporal de demoras por máquina"
            style={{ background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 6, overflowX: 'auto' }}
          >
            <table className="table" style={{ fontSize: 11.5, margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--panel)', zIndex: 2, minWidth: 150, padding: '6px 10px' }}>
                    Máquina
                  </th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', minWidth: 68 }}>Prom.</th>
                  {series.map((d, idx) => (
                    <th
                      key={d.bucket_key || idx}
                      style={{
                        textAlign: 'center',
                        padding: '6px 4px',
                        minWidth: 46,
                        fontWeight: idx === series.length - 1 ? 700 : 500,
                        color: idx === series.length - 1 ? 'var(--brand)' : 'var(--ink-3)',
                        background: idx === series.length - 1 ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                      }}
                      className="mono"
                    >
                      {d.dia}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleMachinesMatrix.map(m => {
                  const isSelected = String(chartMachineId) === String(m.id);
                  const avgColor = m.avg_total_s > 15 ? 'var(--bad)' : m.avg_total_s > 8 ? 'var(--warn)' : 'var(--ok)';
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setChartMachineId(isSelected ? 'ALL' : String(m.id))}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                      }}
                      title="Clic para ver esta máquina en el gráfico de barras de arriba"
                    >
                      <td style={{ position: 'sticky', left: 0, background: isSelected ? '#eef4ff' : 'var(--panel)', zIndex: 1, padding: '6px 10px', fontWeight: 600 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 165 }}>
                          {m.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 400 }}>
                          {m.client_name}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: avgColor }} className="mono">
                        {sec(m.avg_total_s)}
                      </td>
                      {series.map((d, idx) => {
                        const cell = (d.by_machine || []).find(bm => String(bm.machine_id) === String(m.id));
                        if (!cell || !cell.acked_count) {
                          return (
                            <td
                              key={d.bucket_key || idx}
                              style={{
                                textAlign: 'center',
                                padding: '5px 3px',
                                color: 'var(--line)',
                                background: idx === series.length - 1 ? 'rgba(37, 99, 235, 0.03)' : 'transparent',
                              }}
                              className="mono"
                            >
                              ·
                            </td>
                          );
                        }
                        const val = Number(cell.avg_total_s || 0);
                        const bg = val > 15 ? 'rgba(239, 68, 68, 0.14)' : val > 8 ? 'rgba(245, 158, 11, 0.14)' : 'rgba(16, 185, 129, 0.12)';
                        const fg = val > 15 ? 'var(--bad)' : val > 8 ? '#b45309' : 'var(--ok)';
                        return (
                          <td
                            key={d.bucket_key || idx}
                            title={`${m.name} (${d.dia_full || d.dia})\nTotal: ${val.toFixed(1)}s (${cell.acked_count} ventas)\n• 1. Espera Poll: ${cell.avg_queue_to_poll_s}s\n• 2A. Pulsos Físicos: ${cell.avg_physical_s}s\n• 2B. Red ACK: +${cell.avg_net_overhead_s}s`}
                            style={{
                              textAlign: 'center',
                              padding: '5px 3px',
                              background: bg,
                              color: fg,
                              fontWeight: val > 8 ? 700 : 600,
                              borderRadius: 3,
                            }}
                            className="mono"
                          >
                            {val.toFixed(1)}s
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {activeMachines.length > 8 && (
            <div style={{ marginTop: 6, textAlign: 'right' }}>
              <button
                onClick={() => setShowAllMachinesMatrix(v => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--brand)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showAllMachinesMatrix ? 'Mostrar menos máquinas ▲' : `Ver las ${activeMachines.length} máquinas en la línea de tiempo ▼`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   2. Sección Simplificada: Esquema de Demoras y Diagnóstico
   ============================================================ */
function AccreditationDelaysSection({
  trends,
  period,
  latency,
  byClient,
  byMachine,
  selectedClientId,
  selectedMachineId,
  onSelectClient,
  onSelectMachine,
}) {
  const [activeTab, setActiveTab] = useState('clients'); // 'clients' | 'machines' | 'pulses'
  const [pulseMode, setPulseMode] = useState('slowest'); // 'slowest' | 'recent'
  const [searchQuery, setSearchQuery] = useState('');

  // Si el usuario filtra un cliente arriba, mostramos directamente sus máquinas
  useEffect(() => {
    if (selectedMachineId) {
      setActiveTab('pulses');
    } else if (selectedClientId && activeTab === 'clients') {
      setActiveTab('machines');
    }
  }, [selectedClientId, selectedMachineId]);

  const summary = latency?.summary || {
    total_acked: 0,
    avg_queue_to_poll_s: 0,
    avg_physical_s: 0,
    avg_net_overhead_s: 0,
    avg_poll_to_ack_s: 0,
    avg_total_s: 0,
    delay_poll_count: 0,
    delay_physical_count: 0,
    delay_ack_net_count: 0,
  };

  const filteredClients = useMemo(() => {
    const list = byClient || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(c => c.client_name && c.client_name.toLowerCase().includes(q));
  }, [byClient, searchQuery]);

  const filteredMachines = useMemo(() => {
    const list = byMachine || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.client_name && m.client_name.toLowerCase().includes(q)) ||
      (m.arduino_id && m.arduino_id.toLowerCase().includes(q))
    );
  }, [byMachine, searchQuery]);

  const pulsesList = useMemo(() => {
    const raw = pulseMode === 'slowest' ? (latency?.slowestPulses || []) : (latency?.recentPulses || []);
    if (!searchQuery.trim()) return raw;
    const q = searchQuery.toLowerCase();
    return raw.filter(p =>
      (p.machine_name && p.machine_name.toLowerCase().includes(q)) ||
      (p.client_name && p.client_name.toLowerCase().includes(q)) ||
      (p.pulse_id && p.pulse_id.toLowerCase().includes(q))
    );
  }, [latency?.slowestPulses, latency?.recentPulses, pulseMode, searchQuery]);

  const totalAcked = Math.max(summary.total_acked, 0);

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Título de la sección */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--brand)', display: 'inline-flex' }}>{Icon.clock}</span>
          2. Diagnóstico de Demoras de Acreditación (Pago → Poll → ACK)
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
          Desglose del tiempo total desde que entra el pago hasta que la máquina termina de acreditar, separando <b>reconexiones de internet</b> vs <b>cantidad de pulsos físicos</b>.
        </div>
      </div>

      {/* ESQUEMA VISUAL: Las 3 Etapas que suman el Tiempo Total */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 12,
          marginBottom: 18,
          background: 'var(--bg)',
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--line)'
        }}
      >
        {/* Etapa 1: Espera de Poll */}
        <div style={{ background: 'var(--panel)', padding: '12px 14px', borderRadius: 6, borderLeft: '4px solid var(--warn)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Etapa 1 · Pago → Poll
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: summary.avg_queue_to_poll_s > 6 ? 'var(--bad)' : 'var(--ink-1)' }} className="mono">
              {sec(summary.avg_queue_to_poll_s)}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Espera de Poll</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.35 }}>
            Lo que tarda la placa en venir a buscar el pago (normal ≤ 3.5s).
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)', color: summary.delay_poll_count > 0 ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 }}>
            {summary.delay_poll_count > 0
              ? `⚠️ ${num(summary.delay_poll_count)} ventas tardaron >6s (reconexión previa)`
              : '✅ Sin demoras al levantar el poll'}
          </div>
        </div>

        {/* Etapa 2A: Pulsos Físicos */}
        <div style={{ background: 'var(--panel)', padding: '12px 14px', borderRadius: 6, borderLeft: '4px solid var(--ink-3)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Etapa 2A · En el Poll → ACK
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
              {sec(summary.avg_physical_s)}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Pulsos Físicos (Relé)</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.35 }}>
            Lo que tarda el relé enviando los pulsos a la máquina antes del ACK.
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)', color: 'var(--ink-2)', fontWeight: 600 }}>
            ⚙️ {num(summary.delay_physical_count)} ventas con ≥8s de pulso físico
          </div>
        </div>

        {/* Etapa 2B: Demora de Red / Reconexión ACK */}
        <div style={{ background: 'var(--panel)', padding: '12px 14px', borderRadius: 6, borderLeft: '4px solid var(--bad)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Etapa 2B · En el Poll → ACK
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: summary.avg_net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)' }} className="mono">
              +{sec(summary.avg_net_overhead_s)}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Red / Reconexión ACK</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.35 }}>
            Tiempo de internet para confirmar el ACK tras pulsar (normal ≤ 2s).
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)', color: summary.delay_ack_net_count > 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 600 }}>
            {summary.delay_ack_net_count > 0
              ? `📡 ${num(summary.delay_ack_net_count)} ventas con reconexión en ACK (>5s)`
              : '✅ Confirmación de ACK inmediata'}
          </div>
        </div>

        {/* Total Punta a Punta */}
        <div style={{ background: 'var(--panel)', padding: '12px 14px', borderRadius: 6, borderLeft: '4px solid var(--brand)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Resultado · Pago → ACK
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
              {sec(summary.avg_total_s)}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Total Promedio</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.35 }}>
            Poll → ACK total: <b>{sec(summary.avg_poll_to_ack_s)}</b> ({sec(summary.avg_physical_s)} relé + {sec(summary.avg_net_overhead_s)} red).
          </div>
          <div style={{ fontSize: 11.5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)', color: 'var(--ink-2)' }}>
            Base: <b>{num(totalAcked)}</b> ventas acreditadas
          </div>
        </div>
      </div>

      {/* GRÁFICO DE EVOLUCIÓN TEMPORAL DE DEMORAS + LÍNEA DE TIEMPO POR MÁQUINA */}
      <LatencyTrendsChart
        trends={trends}
        period={period}
        byMachine={byMachine}
      />

      {/* Barra de Navegación de Pestañas (Por Cliente | Por Máquina | Detalle de Ventas) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: 3, gap: 2 }}>
          <button
            onClick={() => setActiveTab('clients')}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              borderRadius: 4,
              border: 'none',
              background: activeTab === 'clients' ? 'var(--panel)' : 'transparent',
              boxShadow: activeTab === 'clients' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              color: activeTab === 'clients' ? 'var(--ink-1)' : 'var(--ink-3)',
              fontWeight: activeTab === 'clients' ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            Por Cliente ({filteredClients.length})
          </button>
          <button
            onClick={() => setActiveTab('machines')}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              borderRadius: 4,
              border: 'none',
              background: activeTab === 'machines' ? 'var(--panel)' : 'transparent',
              boxShadow: activeTab === 'machines' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              color: activeTab === 'machines' ? 'var(--ink-1)' : 'var(--ink-3)',
              fontWeight: activeTab === 'machines' ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            Por Máquina ({filteredMachines.length})
          </button>
          <button
            onClick={() => setActiveTab('pulses')}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              borderRadius: 4,
              border: 'none',
              background: activeTab === 'pulses' ? 'var(--panel)' : 'transparent',
              boxShadow: activeTab === 'pulses' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              color: activeTab === 'pulses' ? 'var(--ink-1)' : 'var(--ink-3)',
              fontWeight: activeTab === 'pulses' ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            Ventas Puntuales ({pulsesList.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {activeTab === 'pulses' && (
            <div style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: 2 }}>
              <button
                onClick={() => setPulseMode('slowest')}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  background: pulseMode === 'slowest' ? 'var(--bad)' : 'transparent',
                  color: pulseMode === 'slowest' ? '#fff' : 'var(--ink-2)',
                  cursor: 'pointer',
                  fontWeight: pulseMode === 'slowest' ? 600 : 400
                }}
              >
                Top 40 más lentas
              </button>
              <button
                onClick={() => setPulseMode('recent')}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  background: pulseMode === 'recent' ? 'var(--brand)' : 'transparent',
                  color: pulseMode === 'recent' ? '#fff' : 'var(--ink-2)',
                  cursor: 'pointer',
                  fontWeight: pulseMode === 'recent' ? 600 : 400
                }}
              >
                Últimas 40 recientes
              </button>
            </div>
          )}

          <input
            type="text"
            placeholder="Buscar cliente o máquina…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--panel)',
              color: 'var(--ink-1)',
              width: 210
            }}
          />
        </div>
      </div>

      {/* TAB 1: POR CLIENTE */}
      {activeTab === 'clients' && (
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Demoras y reembolsos por cliente" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Cliente</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Ventas / Reemb.</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>1. Espera Poll</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>2. Pulsos Físicos</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>3. Red ACK</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Total (Pago → ACK)</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Motivo Principal de Demora</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No hay clientes para mostrar.
                  </td>
                </tr>
              ) : (
                filteredClients.map((c) => {
                  const pct = Number(c.pct_reembolso || 0);
                  const isClientSelected = selectedClientId === c.client_id;
                  const reason = getDelayReason(c.avg_queue_to_poll_s, c.avg_physical_s, c.avg_net_overhead_s, c.avg_pulses);
                  const reasonStyle = TONE_STYLES[reason.tone] || TONE_STYLES.neutral;

                  return (
                    <tr key={c.client_id} style={{ borderBottom: '1px solid var(--line-2)', background: isClientSelected ? 'var(--tint)' : 'transparent' }}>
                      <td style={{ padding: '11px 12px' }}>
                        <Link to={`/clientes/${c.client_id}`} style={{ fontWeight: 600, color: 'var(--ink-1)', textDecoration: 'none' }}>
                          {c.client_name}
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                          {c.maquinas_activas} {c.maquinas_activas === 1 ? 'máquina' : 'máquinas'}
                        </div>
                      </td>

                      <td style={{ padding: '11px 12px' }} className="mono">
                        <b>{num(c.total_pagos)}</b> ventas
                        <div style={{ fontSize: 11, color: c.reembolsos_done > 0 ? 'var(--bad)' : 'var(--ink-4)' }}>
                          {num(c.reembolsos_done)} reemb. ({pct}%)
                        </div>
                      </td>

                      <td style={{ padding: '11px 12px', color: c.avg_queue_to_poll_s > 6 ? 'var(--bad)' : 'var(--ink-1)', fontWeight: c.avg_queue_to_poll_s > 6 ? 700 : 400 }} className="mono">
                        {sec(c.avg_queue_to_poll_s)}
                      </td>

                      <td style={{ padding: '11px 12px' }} className="mono">
                        {sec(c.avg_physical_s)}
                        {c.avg_pulses > 0 && (
                          <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                            ~{c.avg_pulses} pulsos
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '11px 12px', color: c.avg_net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)', fontWeight: c.avg_net_overhead_s > 5 ? 700 : 600 }} className="mono">
                        {c.avg_net_overhead_s != null ? `+${sec(c.avg_net_overhead_s)}` : '—'}
                      </td>

                      <td style={{ padding: '11px 12px', fontWeight: 700, fontSize: 13.5 }} className="mono">
                        {sec(c.avg_total_s)}
                      </td>

                      <td style={{ padding: '11px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            fontWeight: 600,
                            background: reasonStyle.bg,
                            color: reasonStyle.fg
                          }}
                        >
                          {reason.label}
                        </span>
                      </td>

                      <td style={{ padding: '11px 12px' }}>
                        <button
                          onClick={() => onSelectClient(isClientSelected ? '' : c.client_id)}
                          style={{
                            padding: '4px 10px',
                            fontSize: 11.5,
                            borderRadius: 4,
                            border: '1px solid var(--line)',
                            background: isClientSelected ? 'var(--brand)' : 'var(--panel)',
                            color: isClientSelected ? '#fff' : 'var(--ink-2)',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          {isClientSelected ? 'Quitar filtro' : 'Ver máquinas →'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: POR MÁQUINA */}
      {activeTab === 'machines' && (
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Demoras y salud por máquina" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquina / Cliente</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Señal & Estado</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Ventas / Reemb.</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>1. Espera Poll</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>2. Pulsos Físicos</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>3. Red ACK</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Total (Pago → ACK)</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Motivo de Demora</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredMachines.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No se encontraron máquinas con el filtro actual.
                  </td>
                </tr>
              ) : (
                filteredMachines.map((m) => {
                  const isSelected = selectedMachineId === m.id;
                  const reason = getDelayReason(m.avg_queue_to_poll_s, m.avg_physical_s, m.avg_net_overhead_s, m.avg_pulses);
                  const reasonStyle = TONE_STYLES[reason.tone] || TONE_STYLES.neutral;

                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--line-2)', background: isSelected ? 'var(--tint)' : 'transparent' }}>
                      <td style={{ padding: '11px 12px' }}>
                        <Link to={`/maquinas/${m.id}`} style={{ fontWeight: 600, color: 'var(--ink-1)', textDecoration: 'none' }}>
                          {m.name}
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {m.client_name} · <span className="mono">{m.arduino_id}</span>
                        </div>
                      </td>

                      <td style={{ padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: m.state === 'online' ? 'var(--ok)' : m.state === 'out_of_service' ? 'var(--warn)' : 'var(--bad)'
                            }}
                          />
                          <span style={{ fontSize: 12 }}>
                            {m.rssi ? `${m.rssi} dBm` : (m.state === 'online' ? 'Online' : 'Offline')}
                          </span>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }} className="mono">
                            v{m.firmware_version}
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                          Visto {timeAgo(m.last_seen_at)}
                        </div>
                      </td>

                      <td style={{ padding: '11px 12px' }} className="mono">
                        <b>{num(m.total_pagos)}</b> ventas
                        <div style={{ fontSize: 11, color: m.reembolsos_done > 0 ? 'var(--bad)' : 'var(--ink-4)' }}>
                          {num(m.reembolsos_done)} reemb. ({m.pct_reembolso}%)
                        </div>
                      </td>

                      <td style={{ padding: '11px 12px', color: m.avg_queue_to_poll_s > 6 ? 'var(--bad)' : 'var(--ink-1)', fontWeight: m.avg_queue_to_poll_s > 6 ? 700 : 400 }} className="mono">
                        {sec(m.avg_queue_to_poll_s)}
                      </td>

                      <td style={{ padding: '11px 12px' }} className="mono">
                        {sec(m.avg_physical_s)}
                        {m.avg_pulses != null && (
                          <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                            ~{m.avg_pulses} pulsos
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '11px 12px', color: m.avg_net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)', fontWeight: m.avg_net_overhead_s > 5 ? 700 : 600 }} className="mono">
                        {m.avg_net_overhead_s != null ? `+${sec(m.avg_net_overhead_s)}` : '—'}
                      </td>

                      <td style={{ padding: '11px 12px', fontWeight: 700, fontSize: 13.5 }} className="mono">
                        {sec(m.avg_total_s)}
                      </td>

                      <td style={{ padding: '11px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            fontWeight: 600,
                            background: reasonStyle.bg,
                            color: reasonStyle.fg
                          }}
                        >
                          {reason.label}
                        </span>
                      </td>

                      <td style={{ padding: '11px 12px' }}>
                        <button
                          onClick={() => onSelectMachine(isSelected ? '' : m.id)}
                          style={{
                            padding: '4px 10px',
                            fontSize: 11.5,
                            borderRadius: 4,
                            border: '1px solid var(--line)',
                            background: isSelected ? 'var(--brand)' : 'var(--panel)',
                            color: isSelected ? '#fff' : 'var(--ink-2)',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          {isSelected ? 'Quitar filtro' : 'Ver ventas →'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: DETALLE DE VENTAS PUNTUALES */}
      {activeTab === 'pulses' && (
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Detalle de ventas y tiempos de acreditación" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Fecha / Hora (AR)</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Máquina / Cliente</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Monto & Pulsos</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>1. Espera Poll</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>2. Pulsos Físicos</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>3. Red ACK</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Total (Pago → ACK)</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>¿Qué causó el tiempo?</th>
              </tr>
            </thead>
            <tbody>
              {pulsesList.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No hay ventas acreditadas para los filtros actuales.
                  </td>
                </tr>
              ) : (
                pulsesList.map((p) => {
                  const reason = getDelayReason(p.queue_to_poll_s, p.physical_s, p.net_overhead_s, p.pulses_count);
                  const reasonStyle = TONE_STYLES[reason.tone] || TONE_STYLES.neutral;
                  return (
                    <tr key={p.pulse_id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '10px 12px' }} className="mono">
                        <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{p.created_at_ar}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                          Poll {p.delivered_at_ar} → ACK {p.acked_at_ar}
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px' }}>
                        <Link to={`/maquinas/${p.machine_id}`} style={{ fontWeight: 600, color: 'var(--ink-1)', textDecoration: 'none' }}>
                          {p.machine_name}
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.client_name}</div>
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        <b>{p.amount ? ars(p.amount) : '—'}</b>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {p.pulses_count} {p.pulses_count === 1 ? 'pulso' : 'pulsos'}
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px', color: p.queue_to_poll_s > 6 ? 'var(--bad)' : 'var(--ink-1)', fontWeight: p.queue_to_poll_s > 6 ? 700 : 400 }} className="mono">
                        {sec(p.queue_to_poll_s)}
                      </td>

                      <td style={{ padding: '10px 12px' }} className="mono">
                        {sec(p.physical_s)}
                      </td>

                      <td style={{ padding: '10px 12px', color: p.net_overhead_s > 5 ? 'var(--bad)' : 'var(--ok)', fontWeight: p.net_overhead_s > 5 ? 700 : 600 }} className="mono">
                        +{sec(p.net_overhead_s)}
                      </td>

                      <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13.5 }} className="mono">
                        {sec(p.total_s)}
                      </td>

                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            fontWeight: 600,
                            background: reasonStyle.bg,
                            color: reasonStyle.fg
                          }}
                        >
                          {reason.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

  const [period, setPeriod] = useState('7d'); // 'today', '24h', '7d', '30d'
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

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
          {/* Header con selectores de Cliente, Máquina y Período */}
          <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--brand)' }}>{Icon.pulse}</span> Monitoreo de Ventas, Reembolsos y Demoras
              </h1>
              <div className="page-subtitle">
                Filtrá por cliente o máquina para auditar reembolsos y entender qué demora la acreditación en cada equipo.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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

              <button
                className="btn"
                onClick={loadMetrics}
                disabled={loading}
                title="Actualizar datos"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {loading ? 'Cargando…' : 'Refrescar'}
              </button>
            </div>
          </div>

          {error && (
            <div className="card" style={{ padding: 16, background: 'var(--bad-soft)', borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>
              <b>Error:</b> {error}
            </div>
          )}

          {/* 4 KPIs Ejecutivos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Ventas Aprobadas</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {ars(kpis.total_approved_amount)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ok)', marginTop: 4 }}>
                <b>{num(kpis.total_approved)}</b> transacciones
              </div>
            </div>

            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Tasa de Reembolso</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: refundRateColor }} className="mono">
                {kpis.overall_refund_rate}%
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--bad)', marginTop: 4 }}>
                {num(kpis.total_refunded_count)} devueltas ({ars(kpis.total_refunded_amount)})
              </div>
            </div>

            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Tiempo Total (Pago → ACK)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)' }} className="mono">
                {sec(data?.latency?.summary?.avg_total_s)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }} className="mono">
                Poll: {sec(data?.latency?.summary?.avg_queue_to_poll_s)} + Pulsos: {sec(data?.latency?.summary?.avg_physical_s)} + Red: {sec(data?.latency?.summary?.avg_net_overhead_s)}
              </div>
            </div>

            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Máquinas en Alcance</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: kpis.critical_machines_count > 0 ? 'var(--bad)' : 'var(--ink-1)' }} className="mono">
                {kpis.total_machines} equipos
              </div>
              <div style={{ fontSize: 11.5, color: kpis.critical_machines_count > 0 ? 'var(--bad)' : 'var(--ok)', marginTop: 4 }}>
                {kpis.critical_machines_count > 0 ? `${kpis.critical_machines_count} con reembolsos >10%` : 'Sin máquinas en estado crítico'}
              </div>
            </div>
          </div>

          {/* BLOQUE 1: Gráfico de Ventas vs Reembolsos */}
          <DailyTrendsChart
            trends={data?.dailyTrends || []}
            period={period}
            causes={causes}
          />

          {/* BLOQUE 2: Esquema de Demoras (Pago -> Poll -> ACK) + Gráfico Temporal + Tabla */}
          <AccreditationDelaysSection
            trends={data?.dailyTrends || []}
            period={period}
            latency={data?.latency}
            byClient={data?.byClient || []}
            byMachine={data?.byMachine || []}
            selectedClientId={selectedClientId}
            selectedMachineId={selectedMachineId}
            onSelectClient={handleClientChange}
            onSelectMachine={(mId) => setSelectedMachineId(mId)}
          />
        </div>
      </div>
    </div>
  );
}

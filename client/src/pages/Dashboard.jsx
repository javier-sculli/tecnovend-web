import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { apiFetch } from '../api.js';

/* ---------- Helpers ---------- */
const ars = (n) => "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 0 }) + " ARS";
const num = (n) => n.toLocaleString("es-AR");

const timeAgo = (ts) => {
  if (!ts) return 'nunca';
  const ms = Date.now() - new Date(ts.replace(' ', 'T') + (ts.includes('Z') ? '' : 'Z')).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `hace ${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

// Parsear input date local (sin desfase horaria)
const parseLocalDate = (dateStr, isEnd = false) => {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isEnd) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

// Obtener rango de fechas preestablecidas
const getPeriodDates = (periodKey) => {
  const now = new Date();
  const until = new Date();
  until.setHours(23, 59, 59, 999);

  let since = new Date();
  since.setHours(0, 0, 0, 0);

  if (periodKey === '24h') {
    // Hoy (desde las 00:00 de hoy)
  } else if (periodKey === '7d') {
    // Esta semana (desde el lunes)
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    since.setDate(diff);
  } else if (periodKey === '30d') {
    // Último mes (últimos 30 días)
    since.setDate(now.getDate() - 30);
  }
  return { since, until };
};

/* ---------- KPI Component ---------- */
function KPI({ label, ico, value, note, colorClass = "" }) {
  return (
    <div className={`card kpi ${colorClass}`}>
      <div className="kpi-label">
        <span className="ico">{ico}</span>
        {label}
      </div>
      <div className="kpi-value mono">
        {value}
      </div>
      <div className="kpi-foot">
        <span>{note}</span>
      </div>
    </div>
  );
}

/* ---------- Sales Line Chart Component ---------- */
function SalesChart({ chartData }) {
  const [hover, setHover] = useState(null);
  
  if (!chartData || chartData.length === 0) {
    return (
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div className="card-head" style={{ padding: '0 0 16px 0', borderBottom: '1px solid var(--line-2)' }}>
          <div className="card-title">Histórico de Ventas y Transacciones</div>
        </div>
        <div style={{ height: 180, display: 'grid', placeItems: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          No hay datos suficientes para graficar en este período.
        </div>
      </div>
    );
  }

  // Dimensiones del SVG
  const W = 800, H = 120;
  const padL = 50, padR = 50, padT = 10, padB = 22;

  // Valores máximos para escalar
  const maxAmount = Math.max(...chartData.map(d => d.amount)) || 1000;
  const maxCount = Math.max(...chartData.map(d => d.count)) || 10;
  
  // Agregar margen de seguridad arriba
  const maxAmountWithBuffer = maxAmount * 1.15;
  const maxCountWithBuffer = maxCount * 1.15;

  // Helpers para obtener coordenadas
  const getX = (index) => {
    if (chartData.length <= 1) return padL;
    return padL + (index / (chartData.length - 1)) * (W - padL - padR);
  };
  
  const getYAmount = (amount) => {
    return padT + (1 - (amount / maxAmountWithBuffer)) * (H - padT - padB);
  };
  
  const getYCount = (count) => {
    return padT + (1 - (count / maxCountWithBuffer)) * (H - padT - padB);
  };

  // Caminos de las líneas
  let amountLine = "";
  let amountArea = "";
  let countLine = "";
  
  if (chartData.length > 0) {
    amountLine = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(i).toFixed(1)},${getYAmount(d.amount).toFixed(1)}`).join(' ');
    amountArea = amountLine + ` L ${getX(chartData.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L ${getX(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
    
    countLine = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(i).toFixed(1)},${getYCount(d.count).toFixed(1)}`).join(' ');
  }

  // Divisiones de la cuadrícula horizontal (Y) - 3 divisiones para gráfico compacto
  const gridDivisions = 3;
  const yGridLines = Array.from({ length: gridDivisions }).map((_, idx) => {
    const ratio = idx / (gridDivisions - 1);
    const amountVal = maxAmountWithBuffer * ratio;
    const countVal = maxCountWithBuffer * ratio;
    const y = getYAmount(amountVal);
    return { y, amountVal, countVal };
  });

  return (
    <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
      <div className="card-head" style={{ padding: '0 0 10px 0', borderBottom: '1px solid var(--line-2)' }}>
        <div>
          <div className="card-title" style={{ fontSize: 13 }}>Histórico de Ventas y Transacciones</div>
          <div className="card-sub" style={{ fontSize: 11 }}>Evolución en el período seleccionado</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11.5 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-1)' }}>
            <span style={{ width: 10, height: 3, background: '#c2410c', borderRadius: 2 }} />
            Ingresos ($ ARS)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
            <span style={{ width: 10, height: 3, borderTop: '2px dashed #71717a' }} />
            Ventas
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 10, userSelect: 'none' }}>
        <svg 
          viewBox={`0 0 ${W} ${H}`} 
          width="100%" 
          height="100%" 
          style={{ overflow: 'visible' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * W;
            let closestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < chartData.length; i++) {
              const dx = Math.abs(getX(i) - mouseX);
              if (dx < minDist) {
                minDist = dx;
                closestIdx = i;
              }
            }
            if (minDist < (W / chartData.length) * 1.5) {
              setHover(closestIdx);
            }
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="amountGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#c2410c" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Líneas de cuadrícula horizontal y etiquetas de ejes Y */}
          {yGridLines.map((line, idx) => (
            <g key={idx}>
              <line 
                x1={padL} 
                x2={W - padR} 
                y1={line.y} 
                y2={line.y} 
                stroke="var(--line-2)" 
                strokeDasharray="3 3" 
              />
              
              {/* Eje Y Izquierdo (Monto $) */}
              <text 
                x={padL - 8} 
                y={line.y + 3.5} 
                fontSize="9" 
                fill="var(--ink-3)" 
                textAnchor="end"
                fontFamily="Geist Mono"
              >
                ${Math.round(line.amountVal).toLocaleString('es-AR')}
              </text>
              
              {/* Eje Y Derecho (Cantidad u.) */}
              <text 
                x={W - padR + 8} 
                y={line.y + 3.5} 
                fontSize="9" 
                fill="var(--ink-3)" 
                textAnchor="start"
                fontFamily="Geist Mono"
              >
                {Math.round(line.countVal)} v.
              </text>
            </g>
          ))}

          {/* Gráfico de áreas y líneas */}
          {chartData.length > 1 && (
            <>
              {/* Área del Monto */}
              <path d={amountArea} fill="url(#amountGrad)" />
              
              {/* Línea del Monto ($) */}
              <path d={amountLine} fill="none" stroke="#c2410c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              
              {/* Línea de la Cantidad */}
              <path d={countLine} fill="none" stroke="#71717a" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Etiquetas del eje X (Fechas / Horas) */}
          {chartData.map((d, i) => {
            const showLabel = chartData.length <= 15 || i % Math.ceil(chartData.length / 8) === 0 || i === chartData.length - 1;
            if (!showLabel) return null;
            return (
              <text 
                key={i} 
                x={getX(i)} 
                y={H - 6} 
                fontSize="9" 
                fill="var(--ink-3)" 
                textAnchor="middle"
                fontFamily="Geist Mono"
              >
                {d.label}
              </text>
            );
          })}

          {/* Indicadores sobre el punto al pasar el cursor */}
          {hover !== null && chartData[hover] && (
            <g>
              <line 
                x1={getX(hover)} 
                x2={getX(hover)} 
                y1={padT} 
                y2={H - padB} 
                stroke="var(--ink-2)" 
                strokeWidth="1" 
                strokeDasharray="2 2" 
              />
              
              <circle 
                cx={getX(hover)} 
                cy={getYAmount(chartData[hover].amount)} 
                r="4.5" 
                fill="#c2410c" 
                stroke="#fff" 
                strokeWidth="2" 
              />
              
              <circle 
                cx={getX(hover)} 
                cy={getYCount(chartData[hover].count)} 
                r="4" 
                fill="#71717a" 
                stroke="#fff" 
                strokeWidth="1.5" 
              />
            </g>
          )}
        </svg>

        {/* Tooltip flotante */}
        {hover !== null && chartData[hover] && (
          <div 
            style={{
              position: 'absolute',
              left: `${Math.min(getX(hover) / W * 100, 80)}%`,
              top: '-45px',
              background: '#18181b',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 10,
              pointerEvents: 'none',
              fontFamily: 'Geist, sans-serif',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              border: '1px solid #27272a',
              transform: 'translateX(-50%)'
            }}
          >
            <div style={{ fontWeight: '600', borderBottom: '1px solid #27272a', paddingBottom: 2, color: '#a1a1aa', fontSize: 11 }}>
              {chartData[hover].label}
            </div>
            <div>
              <span style={{ color: '#fdba74', fontWeight: '500' }}>Ingresos:</span> ${chartData[hover].amount.toLocaleString('es-AR')}
            </div>
            <div>
              <span style={{ color: '#cbd5e1', fontWeight: '500' }}>Ventas:</span> {chartData[hover].count} transacciones
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Main Dashboard Component ---------- */
export default function Dashboard() {
  const [period, setPeriod] = useState("30d");
  const [envProd, setEnvProd] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  
  // Rango de fechas personalizado (input value YYYY-MM-DD)
  const todayStr = new Date().toISOString().split('T')[0];
  const lastWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [customSince, setCustomSince] = useState(lastWeekStr);
  const [customUntil, setCustomUntil] = useState(todayStr);

  const periods = [
    ["24h", "Hoy"],
    ["7d", "Esta semana"],
    ["30d", "Último mes"],
    ["custom", "Personalizado"]
  ];

  // Calcular las fechas since y until basadas en la selección actual
  let sinceDate, untilDate;
  if (period === 'custom') {
    sinceDate = parseLocalDate(customSince, false);
    untilDate = parseLocalDate(customUntil, true);
  } else {
    const dates = getPeriodDates(period);
    sinceDate = dates.since;
    untilDate = dates.until;
  }

  // Fetch de estadísticas
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams({
        since: sinceDate.toISOString(),
        until: untilDate.toISOString()
      });
      
      const res = await apiFetch(`/api/dashboard/summary?${queryParams.toString()}`);
      setData(res);
    } catch (e) {
      console.error(e);
      setError(e.message || "Error al cargar estadísticas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [period, customSince, customUntil]);

  // Reloj en tiempo real
  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString("es-AR"));
  useEffect(() => {
    const t = setInterval(() => setTimeStr(new Date().toLocaleTimeString("es-AR")), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={["Inicio", "Dashboard"]} />
        <div className="page" data-screen-label="01 Dashboard">
          
          {/* Cabecera de Página */}
          <div className="page-head">
            <div>
              <h1 className="page-title">Resumen de Ventas y Flota</h1>
              <div className="page-subtitle">
                <span className="pill live"><span className="d"></span>En vivo · {timeStr} ART</span>
                {data && (
                  <span style={{ marginLeft: 10 }}>
                    {data.fleetHealth.online} de {data.fleetHealth.total} máquinas vendiendo en línea
                  </span>
                )}
              </div>
            </div>
            
            <div className="head-controls" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="seg">
                  {periods.map(([k, l]) => (
                    <button 
                      key={k} 
                      className={period === k ? "on" : ""} 
                      onClick={() => setPeriod(k)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <button className="btn" title="Recargar" onClick={loadDashboardData} disabled={loading}>
                  {Icon.refresh}
                </button>
              </div>

              {period === 'custom' && (
                <div className="custom-date-range-picker" style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--panel)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Desde:</span>
                  <input 
                    type="date" 
                    value={customSince} 
                    onChange={(e) => setCustomSince(e.target.value)} 
                    style={{ background: 'transparent', border: '0', color: 'var(--ink-1)', fontSize: 13, fontFamily: 'inherit' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>Hasta:</span>
                  <input 
                    type="date" 
                    value={customUntil} 
                    onChange={(e) => setCustomUntil(e.target.value)} 
                    style={{ background: 'transparent', border: '0', color: 'var(--ink-1)', fontSize: 13, fontFamily: 'inherit' }}
                  />
                </div>
              )}
            </div>
          </div>

          {error && (
            <div style={{ padding: 16, background: 'var(--bad-soft)', color: 'var(--bad)', borderRadius: 8, marginBottom: 16, border: '1px solid #fee2e2' }}>
              ⚠️ {error}. <button onClick={loadDashboardData} style={{ background: 'none', border: 'none', textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>Reintentar</button>
            </div>
          )}

          {loading && !data && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
              <span className="spinner" style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid var(--line-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 10, verticalAlign: 'middle' }}></span>
              Cargando estadísticas reales...
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {data && (
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
              
              {/* KPIs Principales Comerciales */}
              <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}>
                <KPI
                  label="Ventas Acumuladas"
                  ico={Icon.coin}
                  value={ars(data.kpis.total_revenue)}
                  note="Volumen bruto aprobado"
                />
                <KPI
                  label="Cantidad de Ventas"
                  ico={Icon.card}
                  value={`${num(data.kpis.total_payments)} transacciones`}
                  note="Cobros validados correctamente"
                />
                <KPI
                  label="Reembolsos por Falla"
                  ico={Icon.clock}
                  value={ars(data.kpis.total_refunded)}
                  note={`${num(data.kpis.total_refund_count)} devoluciones automáticas`}
                  colorClass={data.kpis.total_refunded > 0 ? "warn-kpi" : ""}
                />
              </div>

              {/* Gráfico Histórico de Ventas y Transacciones (Agregado) */}
              <SalesChart chartData={data.chartData} />

              {/* Salud de Flota */}
              <div className="grid-3" style={{ marginBottom: 14 }}>
                
                {/* Panel de Máquinas */}
                <div className="card">
                  <div className="card-head">
                    <div>
                      <div className="card-title">Listado de Máquinas</div>
                      <div className="card-sub">Monitoreo de actividad e inestabilidades de red/energía</div>
                    </div>
                  </div>
                  
                  {/* Tabla de Máquinas */}
                  <div>
                    <div className="machine head" style={{ gridTemplateColumns: '14px 1.5fr 1.2fr 1fr 1fr 14px' }}>
                      <span></span>
                      <span>Máquina</span>
                      <span>Sede</span>
                      <span>Último contacto</span>
                      <span style={{ textAlign: "center" }}>Reencendidos</span>
                      <span></span>
                    </div>

                    {data.machinesList.length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                        No hay máquinas registradas en esta cuenta.
                      </div>
                    ) : (
                      data.machinesList.map((m, i) => {
                        const isOffline = m.state === 'offline';
                        const isMaint = m.state === 'out_of_service';
                        
                        return (
                          <div className="machine" key={m.id} style={{ gridTemplateColumns: '14px 1.5fr 1.2fr 1fr 1fr 14px' }}>
                            <span className={`status-dot ${isOffline ? 'off' : isMaint ? 'warn' : 'ok'}`} title={m.state}></span>
                            
                            <div className="m-name">
                              <span className="n">{m.name}</span>
                              <span className="id mono">{m.id}</span>
                            </div>
                            
                            <div className="m-loc">
                              <div>{m.location || 'Sin sede'}</div>
                            </div>
                            
                            <div className="mono" style={{ fontSize: 12, color: isOffline ? '#b91c1c' : 'var(--ink-2)' }}>
                              {timeAgo(m.last_seen)}
                            </div>
                            
                            <div style={{ textAlign: 'center' }}>
                              {m.reboots_in_period > 0 ? (
                                <span className="delta warn" style={{ fontSize: 11, fontWeight: '600' }} title="Reinicios en este periodo">
                                  ⚡ {m.reboots_in_period} reencendidos
                                </span>
                              ) : (
                                <span style={{ color: 'var(--ok)', fontSize: 12, fontWeight: '500' }}>
                                  ✓ Estable
                                </span>
                              )}
                            </div>
                            
                            <div className="chev">{Icon.chev}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Resumen Salud de Flota (Consolidado) */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="card-head">
                    <div>
                      <div className="card-title">Salud de la Flota</div>
                      <div className="card-sub">Resumen de conexión en vivo</div>
                    </div>
                  </div>
                  
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center', flex: 1 }}>
                    
                    {/* Barra de Progreso Visual */}
                    <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--line-2)' }}>
                      <div style={{ 
                        width: data.fleetHealth.total > 0 ? `${(data.fleetHealth.online / data.fleetHealth.total) * 100}%` : '0%', 
                        background: 'var(--ok)' 
                      }} title="En línea" />
                      <div style={{ 
                        width: data.fleetHealth.total > 0 ? `${(data.fleetHealth.out_of_service / data.fleetHealth.total) * 100}%` : '0%', 
                        background: 'var(--warn)' 
                      }} title="Fuera de servicio" />
                      <div style={{ 
                        width: data.fleetHealth.total > 0 ? `${(data.fleetHealth.offline / data.fleetHealth.total) * 100}%` : '0%', 
                        background: 'var(--ink-4)' 
                      }} title="Desconectadas" />
                    </div>

                    {/* Leyenda y Datos */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
                        <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ok)' }} />
                          En línea (Operativas)
                        </span>
                        <span className="mono" style={{ fontWeight: '600' }}>{data.fleetHealth.online}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
                        <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--warn)' }} />
                          Fuera de servicio
                        </span>
                        <span className="mono" style={{ fontWeight: '600' }}>{data.fleetHealth.out_of_service}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ink-4)' }} />
                          Desconectadas (Sin señal)
                        </span>
                        <span className="mono" style={{ fontWeight: '600' }}>{data.fleetHealth.offline}</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Pie de Página */}
              <div style={{ textAlign: "center", padding: "8px 0 0", color: "var(--ink-4)", fontSize: 11.5, letterSpacing: "0.04em" }}>
                VendPoint · Vending OS · v1.0 — Datos Reales del Entorno {envProd ? "Producción" : "Sandbox"}
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { apiFetch, API_BASE } from '../api.js';
import { useAuth } from '../auth.jsx';

/* ---------- Helpers ---------- */
const ars = (n) => "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const num = (n) => n.toLocaleString("es-AR");

// Tiempo relativo desde un timestamp UTC ('YYYY-MM-DD HH:MM:SS' o ISO)
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

const fmtUptime = (sec) => {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const wifiQuality = (rssi) => {
  if (rssi == null) return '—';
  if (rssi >= -60) return 'señal fuerte';
  if (rssi >= -75) return 'señal media';
  return 'señal débil';
};

// Estado consolidado de la máquina (campo `state` del backend)
const stateMeta = {
  online:         { dot: 'ok',   txt: 'Activa' },
  out_of_service: { dot: 'warn', txt: 'Fuera de servicio' },
  offline:        { dot: 'bad',  txt: 'Sin conexión' },
};

function normalizeMachine(m) {
  const channels_config = m.channels_config ?? [];
  return {
    pulsesToday: 0, rev: 0, rev30: 0, payments: 0,
    payments_week: 0, revenue_week: 0,
    firmware: '—', poll: null, pollState: 'cold',
    last_payment: '—',
    ...m,
    channels_config,
    channels: channels_config,
    created: m.created_at?.slice(0, 10) ?? '—',
  };
}

/* ---------- INITIAL DATA ---------- */
const INITIAL_MACHINES = [];

const statusMeta = {
  active:      { dot: "ok",   txt: "Activa",        label: "Activa" },
  maintenance: { dot: "warn", txt: "Mantenimiento", label: "Mant." },
  inactive:    { dot: "off",  txt: "Inactiva",      label: "Inactiva" },
};

/* ---------- Subcomponents ---------- */
function Channels5({ channels }) {
  return (
    <div className="channels-mini" title={`${channels.filter(Boolean).length} de 5 canales configurados`}>
      {[0,1,2,3,4].map(i => (
        <span key={i} className={"ch-dot " + (channels[i] ? "on" : "off")} />
      ))}
    </div>
  );
}

/* ---------- Machine List View ---------- */
function MachineList({ machines, onOpen, onNew, clientsById = {} }) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("table");

  const STATUS_FILTERS = useMemo(() => [
    { id: "all",  label: "Todas",          count: machines.length },
    { id: "active", label: "Activas",      count: machines.filter(m => m.status === "active").length },
    { id: "maintenance", label: "Mantenimiento", count: machines.filter(m => m.status === "maintenance").length },
    { id: "inactive", label: "Inactivas",  count: machines.filter(m => m.status === "inactive").length },
    { id: "untagged", label: "Sin tagear", count: machines.filter(m => !m.terminal_id && !m.pos_id).length },
  ], [machines]);

  const filtered = useMemo(() => {
    let r = machines;
    if (tab === "untagged") r = r.filter(m => !m.terminal_id && !m.pos_id);
    else if (tab !== "all") r = r.filter(m => m.status === tab);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.location.toLowerCase().includes(q) ||
        m.address.toLowerCase().includes(q) ||
        (m.pos_id && m.pos_id.toLowerCase().includes(q)) ||
        (m.terminal_id && m.terminal_id.toLowerCase().includes(q))
      );
    }
    return r;
  }, [tab, query, machines]);

  const totalRev30 = useMemo(() => machines.reduce((s, m) => s + m.rev30, 0), [machines]);

  return (
    <div className="page" data-screen-label="01 Máquinas · Lista">
      <div className="page-head">
        <div>
          <h1 className="page-title">Máquinas <span className="accent">— flota completa</span></h1>
          <div className="summary-chips">
            <span className="chip"><strong>{machines.length}</strong> equipos</span>
            <span className="chip ok"><span className="d"></span><strong>{STATUS_FILTERS[1].count}</strong> activas</span>
            <span className="chip warn"><span className="d"></span><strong>{STATUS_FILTERS[2].count}</strong> mant.</span>
            <span className="chip bad"><span className="d"></span><strong>{STATUS_FILTERS[3].count}</strong> inactivas</span>
            <span className="chip"><strong>{STATUS_FILTERS[4].count}</strong> sin tagear</span>
            <span className="chip"><strong>{ars(totalRev30)}</strong> · 30 d</span>
          </div>
        </div>
        <div className="head-controls">
          <button className="btn">{Icon.download} Exportar CSV</button>
          <button className="btn primary" onClick={onNew}>{Icon.plus} Nueva máquina</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          {STATUS_FILTERS.map(f => (
            <button key={f.id} className={tab === f.id ? "on" : ""} onClick={() => setTab(f.id)}>
              {f.label}<span className="c">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-search">
          {Icon.search}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, sede, pos_id…"
          />
        </div>
        <button className="filter-btn"><span className="label">Sede:</span><span className="value">Todas</span>{Icon.chevDown}</button>
        <button className="filter-btn"><span className="label">Modelo:</span><span className="value">Todos</span>{Icon.chevDown}</button>
        <button className="filter-btn"><span className="label">Tageo:</span><span className="value">Cualquiera</span>{Icon.chevDown}</button>
        <div className="toolbar-spacer"></div>
        <div className="view-toggle">
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")} title="Tabla">{Icon.list}</button>
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} title="Grilla">{Icon.grid}</button>
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")} title="Mapa">{Icon.map}</button>
        </div>
      </div>

      <div className="mlist">
        <div className="mlist-row head">
          <span>Estado</span>
          <span>Máquina</span>
          <span>Cliente</span>
          <span>Sede</span>
          <span>Tageo MP</span>
          <span style={{ textAlign: "right" }}>Pagos · última semana</span>
          <span></span>
        </div>
        {filtered.map((m) => {
          const est = stateMeta[m.state] || stateMeta.offline;
          return (
            <div className="mlist-row" key={m.id} onClick={() => onOpen(m.id)}>
              <span className={"sdot " + est.dot} title={est.txt}></span>
              <div className="mname">
                <span className="n">{m.name}</span>
                <span className="id">{m.id} · {m.model}</span>
              </div>
              <div className="mloc">
                {m.client_id && clientsById[m.client_id]
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-2)" }}>
                      <span style={{ color: "var(--ink-4)", display: "inline-flex" }}>{Icon.building}</span>
                      {clientsById[m.client_id]}
                    </span>
                  : <span style={{ color: "var(--ink-4)" }}>sin cliente</span>}
              </div>
              <div className="mloc">
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--ink-4)", display: "inline-flex" }}>{Icon.pin}</span>
                  {m.location}
                </div>
                <div className="sub">{m.address}</div>
              </div>
              <div className="tag-stack">
                {/* Point oculto hasta tener los posnet físicos (Fase 2) */}
                {m.pos_id ? (
                  <span className="tag qr">{Icon.qr} {m.pos_id}</span>
                ) : (
                  <span className="tag empty">{Icon.qr} sin QR</span>
                )}
              </div>
              <div className="metric-right">
                {m.payments_week
                  ? `${num(m.payments_week)} pago${m.payments_week !== 1 ? "s" : ""}`
                  : <span style={{ color: "var(--ink-4)" }}>—</span>}
                <div className="sub">{m.revenue_week ? ars(m.revenue_week) : "sin actividad"}</div>
              </div>
              <button className="actions-menu" onClick={(e) => { e.stopPropagation(); }}>{Icon.more}</button>
            </div>
          );
        })}
        <div className="list-foot">
          <span>Mostrando <strong style={{ color: "var(--ink-1)" }}>{filtered.length}</strong> de {machines.length} máquinas</span>
          <span className="mono">Actualizado hace 4 s · auto-refresh activo</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Payments Card ---------- */
// Estado de reembolso → badge. 'done' (o refunded_at) = ya devuelto.
const refundView = (p) => {
  if (p.refunded_at || p.refund_status === 'done') return { state: 'done', cls: 'off', txt: '↩ Reembolsado' };
  if (p.refund_status === 'pending') return { state: 'pending', cls: 'warn', txt: '↩ Reembolsando…' };
  if (p.refund_status === 'failed') return { state: 'failed', cls: 'bad', txt: '↩ Reembolso falló' };
  return { state: 'none' };
};

function PaymentsCard({ machineId }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const data = await apiFetch(`/api/mp/payments?machineId=${machineId}&limit=500`);
      setPayments(data); setLastRefresh(new Date());
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) load(); };
    run();
    const t = setInterval(run, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [machineId]);

  const refund = async (p) => {
    if (!confirm(`¿Devolver este pago al cliente por Mercado Pago?\n\nMonto: ${ars(p.amount)} · ${p.mp_payment_id}\nSe reembolsa el total y, si tiene pulsos en cola, se eliminan (no dispensa). No se puede deshacer.`)) return;
    setBusy(p.id);
    try {
      await apiFetch(`/api/mp/payments/${p.id}/refund`, { method: 'POST' });
      await load();
    } catch (e) {
      alert('No se pudo reembolsar: ' + e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <div className="card-title">Pagos</div>
          <div className="card-sub">
            {loading ? 'cargando…' : `${payments.length} registro${payments.length !== 1 ? 's' : ''} · auto-refresh cada 60 s`}
          </div>
        </div>
        {lastRefresh && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
      {!loading && payments.length === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Sin pagos registrados para esta máquina aún.
        </div>
      ) : (
        <>
          <div className="tx pay-row head">
            <span></span>
            <span>ID de pago MP</span>
            <span>Fecha</span>
            <span style={{ textAlign: 'right' }}>Pulsos</span>
            <span style={{ textAlign: 'right' }}>Monto</span>
            <span></span>
          </div>
          {payments.map((p, i) => {
            const rf = refundView(p);
            const canRefund = p.status === 'approved' && rf.state !== 'done' && rf.state !== 'pending';
            return (
              <div className="tx pay-row" key={p.id || i}>
                <div className="tx-method qr">{Icon.qr}</div>
                <div>
                  <div className="tx-prod" style={{ flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 12 }}>...{p.mp_payment_id?.slice(-12)}</span>
                    <span className={'tx-status ' + p.status}>
                      {p.status === 'approved'
                        ? p.pulses_calculated === 0
                          ? <>⚠ aprobado · sin pulsos</>
                          : <>{Icon.check} aprobado</>
                        : p.status}
                    </span>
                    {rf.state !== 'none' && (
                      <span className={'spill ' + rf.cls} title={rf.state === 'failed' ? (p.refund_error || '') : (p.refunded_at ? new Date(p.refunded_at + 'Z').toLocaleString('es-AR') : '')}>
                        {rf.txt}
                      </span>
                    )}
                  </div>
                  <div className="tx-meta mono" style={{ fontSize: 11 }}>{p.mp_payment_id}</div>
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {new Date(p.created_at + 'Z').toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: 'var(--ink-1)' }}>
                  {p.pulses_calculated}p
                </div>
                <div><div className="tx-amount mono">{ars(p.amount)}</div></div>
                <div style={{ textAlign: 'right' }}>
                  {canRefund && (
                    <button
                      className="link-btn"
                      disabled={busy === p.id}
                      onClick={() => refund(p)}
                      title="Reembolsar este pago al cliente por MP"
                      style={{ color: rf.state === 'failed' ? 'var(--bad)' : 'var(--ink-2)' }}
                    >
                      {busy === p.id ? '…' : rf.state === 'failed' ? 'Reintentar' : 'Devolver'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ---------- Events Card ---------- */
const EVENT_ICON = { heartbeat: '♥', config: '⚙', service: '⏻', ack: '✓', payment: '$' };
const EVENT_TYPES = [
  { value: 'heartbeat', label: 'Heartbeat' },
  { value: 'config',    label: 'Configuración' },
  { value: 'service',   label: 'Servicio' },
  { value: 'ack',       label: 'ACK de pulsos' },
  { value: 'payment',   label: 'Pagos' },
];

// "2026-06-16 12:34:56" (UTC) → "2026-06-16" en zona local
const eventLocalDay = (at) => {
  const d = new Date(at.replace(' ', 'T') + 'Z');
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};

function EventsCard({ machineId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [fType, setFType] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await apiFetch(`/api/machines/${machineId}/events?limit=500`);
        if (!cancelled) { setEvents(data); setLastRefresh(new Date()); }
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [machineId]);

  const hasFilters = fType || fFrom || fTo;
  const filtered = events.filter(e => {
    if (fType && e.type !== fType) return false;
    if (fFrom || fTo) {
      const day = e.at ? eventLocalDay(e.at) : '';
      if (fFrom && day < fFrom) return false;
      if (fTo && day > fTo) return false;
    }
    return true;
  });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Eventos</div>
          <div className="card-sub">
            {loading
              ? 'cargando…'
              : `${hasFilters ? `${filtered.length} de ${events.length}` : events.length} evento${(hasFilters ? filtered.length : events.length) !== 1 ? 's' : ''} · heartbeat, config, ACK y pagos · auto-refresh cada 60 s`}
          </div>
        </div>
        {lastRefresh && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
      <div className="events-filters">
        <select value={fType} onChange={e => setFType(e.target.value)}>
          <option value="">Todos los tipos</option>
          {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label className="ef-date">
          <span>Desde</span>
          <input type="date" value={fFrom} max={fTo || undefined} onChange={e => setFFrom(e.target.value)} />
        </label>
        <label className="ef-date">
          <span>Hasta</span>
          <input type="date" value={fTo} min={fFrom || undefined} onChange={e => setFTo(e.target.value)} />
        </label>
        {hasFilters && (
          <button className="ef-clear" onClick={() => { setFType(''); setFFrom(''); setFTo(''); }}>Limpiar</button>
        )}
      </div>
      {!loading && events.length === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Sin eventos registrados para esta máquina aún.
        </div>
      ) : !loading && filtered.length === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Ningún evento coincide con los filtros.
        </div>
      ) : (
        <div className="card-body">
          <div className="timeline">
            {filtered.map((e, i) => (
              <div className={"tl-item " + (e.kind || 'ok')} key={i}>
                <div className="t">
                  <span className="mono" style={{ marginRight: 6, color: 'var(--ink-4)' }}>{EVENT_ICON[e.type] || '•'}</span>
                  {e.title}
                </div>
                {e.desc && <div className="desc">{e.desc}</div>}
                <div className="when">{timeAgo(e.at)} · {new Date(e.at.replace(' ', 'T') + 'Z').toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Pulses Card ---------- */
// Estado → etiqueta + color (spill). 'expired' = no acreditó.
const PULSE_STATUS = {
  pending:   { cls: 'warn', txt: 'En cola' },
  delivered: { cls: 'off',  txt: 'Entregado · esperando ACK' },
  acked:     { cls: 'ok',   txt: 'Acreditado' },
  expired:   { cls: 'bad',  txt: 'No acreditó' },
};

function PulsesCard({ machineId }) {
  const [pulses, setPulses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const data = await apiFetch(`/api/machines/${machineId}/pulses?limit=500`);
      setPulses(data); setLastRefresh(new Date());
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    const t = setInterval(run, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [machineId]);

  const remove = async (p) => {
    const inFlight = p.status === 'pending' || p.status === 'delivered';
    let refund = false;
    if (inFlight) {
      if (!confirm('¿Eliminar este pulso de la cola? No se va a acreditar en la máquina.')) return;
      if (p.payment_id) {
        refund = confirm('¿Devolver también el pago al cliente por Mercado Pago?\n\nAceptar = se reembolsa el total del pago.\nCancelar = solo se elimina el pulso (el pago queda cobrado).');
      }
    } else {
      if (!confirm('¿Borrar este pulso del historial?')) return;
    }
    setBusy(p.id);
    try {
      const r = await apiFetch(`/api/machines/${machineId}/pulses/${p.id}${refund ? '?refund=1' : ''}`, { method: 'DELETE' });
      if (refund && !r.refunded) alert('Pulso eliminado, pero el reembolso falló: ' + (r.refund_error || 'error') + '\nSe va a reintentar automáticamente.');
      setPulses(ps => ps.filter(x => x.id !== p.id));
    } catch (e) {
      alert('No se pudo eliminar: ' + e.message);
    } finally { setBusy(null); }
  };

  const pendientes = pulses.filter(p => p.status === 'pending' || p.status === 'delivered').length;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Pulsos pendientes</div>
          <div className="card-sub">
            {loading ? 'cargando…' : `${pendientes} en cola de ${pulses.length} · auto-refresh cada 60 s · ventana de ACK 3 min`}
          </div>
        </div>
        {lastRefresh && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
      {!loading && pulses.length === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          No hay pulsos en la cola de esta máquina.
        </div>
      ) : (
        <>
          <div className="tx pulse-row head">
            <span></span>
            <span>Pulso</span>
            <span>Estado</span>
            <span style={{ textAlign: 'right' }}>Canal · pulsos</span>
            <span>Creado</span>
            <span></span>
          </div>
          {pulses.map((p) => {
            const st = PULSE_STATUS[p.status] || { cls: 'off', txt: p.status };
            const inFlight = p.status === 'pending' || p.status === 'delivered';
            return (
              <div className="tx pulse-row" key={p.id}>
                <div className="tx-method qr">{Icon.pulse}</div>
                <div>
                  <div className="tx-prod">
                    <span className="mono" style={{ fontSize: 12 }}>{p.id}</span>
                  </div>
                  {p.payment_id && <div className="tx-meta mono" style={{ fontSize: 11 }}>pago {p.payment_id.slice(0, 8)}</div>}
                </div>
                <div><span className={'spill ' + st.cls}>{st.txt}</span></div>
                <div className="mono" style={{ fontSize: 13, textAlign: 'right', color: 'var(--ink-1)' }}>
                  c{p.channel} · {p.count}p
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {new Date(p.created_at + 'Z').toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    className="link-btn"
                    title={inFlight ? 'Eliminar de la cola (con opción de devolver el pago)' : 'Borrar del historial'}
                    disabled={busy === p.id}
                    onClick={() => remove(p)}
                    style={{ color: 'var(--bad)' }}
                  >
                    {Icon.trash}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ---------- Machine QR Card ---------- */
// QR físico de la máquina (el de la caja/POS de MP, para imprimir y pegar).
// El QR impreso es siempre el mismo; el modo (fijo/dinámico) define qué ve el
// cliente al escanear: la orden con precio cargado o el monto libre.
function MachineQRCard({ m }) {
  const [pos, setPos] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null); setPos(null);
    apiFetch(`/api/mp/pos/${m.id}`)
      .then(d => { if (!cancelled) setPos(d); })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [m.id, m.mp_pos_id]);

  const imgSrc = pos?.qr_code_base64
    ? `data:image/png;base64,${pos.qr_code_base64}`
    : (pos?.qr?.image || null);

  const isFixed = m.qr_mode === 'fixed';

  const printQR = () => {
    if (!imgSrc) return;
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>QR · ${m.name}</title></head>
      <body style="display:grid;place-items:center;font-family:sans-serif">
        <div style="text-align:center">
          <h2 style="margin-bottom:4px">${m.name}</h2>
          <p style="margin-top:0;color:#555">${isFixed ? `Precio fijo: $${m.qr_fixed_amount}` : 'Escaneá e ingresá el monto'}</p>
          <img src="${imgSrc}" style="width:340px" onload="setTimeout(()=>window.print(),300)" />
          <p style="color:#999;font-size:12px">${m.id} · Mercado Pago</p>
        </div>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{Icon.qr} QR de la máquina</div>
          <div className="card-sub">El código que se imprime y pega en el equipo.</div>
        </div>
        <span className={'spill ' + (isFixed ? 'ok' : 'off')}>
          {isFixed ? `Precio fijo · $${m.qr_fixed_amount}` : 'Monto libre'}
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {loading ? (
          <div style={{ padding: 24, color: 'var(--ink-4)', fontSize: 13 }}>Cargando QR…</div>
        ) : err ? (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            {err.includes('Sin POS') || err.includes('no_pos')
              ? <>Esta máquina no tiene caja QR de MP todavía.<br /><span style={{ fontSize: 12 }}>Tageala desde la card "Tageo MP" para generar su QR.</span></>
              : <>No se pudo cargar el QR: {err}</>}
          </div>
        ) : (
          <>
            <div style={{ borderRadius: 12, border: '1px solid var(--line-2)', padding: 12, background: '#fff' }}>
              {imgSrc
                ? <img src={imgSrc} alt={`QR de ${m.name}`} style={{ display: 'block', width: 190, height: 190 }} />
                : <div style={{ width: 190, height: 190, display: 'grid', placeItems: 'center', color: 'var(--ink-4)', fontSize: 12 }}>Sin imagen QR</div>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>
              {isFixed
                ? <>Al escanear, el cliente ve <strong>${m.qr_fixed_amount}</strong> ya cargado.</>
                : <>Al escanear, el cliente ingresa el monto que quiere pagar.</>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={printQR} disabled={!imgSrc}>{Icon.download} Imprimir</button>
              {imgSrc && (
                <a className="btn" href={imgSrc} download={`qr_${m.id}.png`} target="_blank" rel="noreferrer">
                  {Icon.qr} Descargar PNG
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Tageo Card ---------- */
function TageoCard({ m, onRefresh }) {
  const [mode, setMode] = useState(null); // 'store' | 'qr' | null
  const [stores, setStores] = useState(null);
  const [allPos, setAllPos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (fields) => {
    await apiFetch(`/api/machines/${m.id}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    });
    await onRefresh();
  };

  const open = async (which) => {
    setErr(''); setMode(which);
    if (which === 'store' && !stores) {
      setBusy(true);
      try { setStores(await apiFetch('/api/mp/stores')); }
      catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    }
    if (which === 'qr' && !allPos) {
      setBusy(true);
      try { setAllPos(await apiFetch('/api/mp/pos')); }
      catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    }
  };

  const saveStore = async (store) => {
    setBusy(true); setErr('');
    try { await save({ mp_store_id: String(store.id), mp_store_name: store.name }); setMode(null); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const linkPOS = async (pos) => {
    setBusy(true); setErr('');
    try {
      await save({ pos_id: pos.external_id || String(pos.id), mp_pos_id: String(pos.id) });
      setMode(null);
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const createPOS = async () => {
    setBusy(true); setErr('');
    try {
      await apiFetch(`/api/mp/pos/${m.id}`, { method: 'POST' });
      await onRefresh();
      setMode(null);
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Tageo · Mercado Pago</div>
          <div className="card-sub">Vincular local y caja QR</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="info-hint" tabIndex={0}>
            {Icon.help || '?'} ¿Qué es esto?
            <span className="info-tip">
              {m.mp_store_name && m.pos_id ? (
                <>
                  Esta máquina y su QR están vinculados al local <strong>{m.mp_store_name}</strong> y
                  a la caja <strong>{m.pos_id}</strong> de Mercado Pago. Por eso, cada pago que se
                  escanea acá se acredita en esa cuenta y queda asociado a esta máquina.
                  Cuando quieras, podés entrar a Mercado Pago: ahí vas a ver el dinero acreditado y,
                  con estos mismos nombres, a qué local y caja corresponde.
                </>
              ) : (
                <>
                  Acá asociás esta máquina a un local y a una caja (QR) de tu cuenta de Mercado Pago.
                  Una vez vinculada, cada pago escaneado se acredita en esa cuenta y queda
                  identificado con esta máquina.
                  Después, entrando a Mercado Pago, vas a poder ver el dinero acreditado y a qué
                  local y caja pertenece —con estos mismos nombres.
                </>
              )}
            </span>
          </span>
          {mode && (
            <button className="link-btn" onClick={() => { setMode(null); setErr(''); }}>Cancelar</button>
          )}
        </div>
      </div>
      <div className="card-body">

        {/* Local */}
        <div className="kv">
          <span className="k">Local MP</span>
          <div className="v">
            {m.mp_store_name && mode !== 'store' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="tag store" style={{ fontSize: 11.5 }}>{Icon.building} {m.mp_store_name}</span>
                <button className="link-btn" onClick={() => open('store')}>cambiar</button>
              </div>
            ) : mode === 'store' ? (
              busy && !stores ? (
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Cargando locales…</span>
              ) : stores?.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Sin locales en esta cuenta MP</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stores?.map(s => (
                    <button key={s.id} className={"filter-btn " + (String(s.id) === m.mp_store_id ? 'on' : '')}
                      style={{ justifyContent: 'flex-start' }} onClick={() => saveStore(s)} disabled={busy}>
                      {Icon.building} {s.name}
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 6 }}>ID {s.id}</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <button className="filter-btn" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => open('store')}>
                {Icon.plus} Asociar local
              </button>
            )}
          </div>
        </div>

        {/* Terminal Point oculto hasta tener los posnet físicos (Fase 2).
            El campo terminal_id sigue en la BD/API; solo se quitó de la UI. */}

        {/* QR */}
        <div className="kv">
          <span className="k">POS · QR</span>
          <div className="v">
            {m.pos_id && mode !== 'qr' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="tag qr" style={{ fontSize: 11.5 }}>{Icon.qr} {m.pos_id}</span>
                <button className="link-btn" onClick={() => open('qr')}>cambiar</button>
              </div>
            ) : mode === 'qr' ? (
              busy && !allPos ? (
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Cargando cajas…</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {allPos?.map(pos => (
                    <button key={pos.id} className={"filter-btn " + (String(pos.id) === m.mp_pos_id ? 'on' : '')}
                      style={{ justifyContent: 'flex-start' }} onClick={() => linkPOS(pos)} disabled={busy}>
                      {Icon.qr} {pos.name || pos.external_id}
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 6 }}>ID {pos.id}</span>
                    </button>
                  ))}
                  <button className="btn" onClick={createPOS} disabled={busy}
                    style={{ fontSize: 12, marginTop: 4, justifyContent: 'center' }}>
                    {busy ? '…' : <>{Icon.plus} Crear nuevo POS en MP</>}
                  </button>
                </div>
              )
            ) : (
              <button className="filter-btn" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => open('qr')}>
                {Icon.plus} Vincular QR
              </button>
            )}
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: 'var(--bad)', marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

/* ---------- Machine Detail View ---------- */
function MachineDetail({ id, machines, onBack, onUpdateMachine, onRefresh, onDelete }) {
  const m = useMemo(() => machines.find(x => x.id === id) || machines[0], [machines, id]);

  const [editMode, setEditMode] = useState(false);
  const [pulseValue, setPulseValue] = useState(m?.pulse_value);
  const [pulseDuration, setPulseDuration] = useState(m?.pulse_duration_ms);
  const [pulseGap, setPulseGap] = useState(m?.pulse_gap_ms);
  const [arduinoId, setArduinoId] = useState(m?.arduino_id ?? "");
  const [wifiSsid, setWifiSsid] = useState(m?.wifi_ssid ?? "");
  const [wifiUser, setWifiUser] = useState(m?.wifi_user ?? "");
  const [wifiPassword, setWifiPassword] = useState(m?.wifi_password ?? "");
  const [qrMode, setQrMode] = useState(m?.qr_mode ?? "dynamic");
  const [qrFixedAmount, setQrFixedAmount] = useState(m?.qr_fixed_amount ?? "");
  const [showWifiPass, setShowWifiPass] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [tab, setTab] = useState("config");

  // Sync state if machine changes — pero NO mientras se está editando, así el
  // auto-refresh de fondo no pisa lo que el usuario está tipeando. Al salir de
  // edición (guardar/cancelar) se vuelve a sincronizar con los datos del server.
  useEffect(() => {
    if (m && !editMode) {
      setPulseValue(m.pulse_value);
      setPulseDuration(m.pulse_duration_ms);
      setPulseGap(m.pulse_gap_ms);
      setArduinoId(m.arduino_id ?? "");
      setWifiSsid(m.wifi_ssid ?? "");
      setWifiUser(m.wifi_user ?? "");
      setWifiPassword(m.wifi_password ?? "");
      setQrMode(m.qr_mode ?? "dynamic");
      setQrFixedAmount(m.qr_fixed_amount ?? "");
    }
  }, [m, editMode]);

  // Importante: el early return va DESPUÉS de todos los hooks. Al refrescar
  // directo en /maquinas/:id, `machines` llega vacío primero (m undefined);
  // cortar antes de los hooks cambiaría su cantidad entre renders y rompe React.
  if (!m) return <div style={{ padding: 40, color: 'var(--ink-3)' }}>Cargando…</div>;
  const conn = stateMeta[m.state] || stateMeta.offline;
  const chCount = m.channels.filter(Boolean).length;

  const toggleStatus = () => {
    const nextStatus = m.status === "active" ? "maintenance" : "active";
    onUpdateMachine(m.id, {
      status: nextStatus,
      pollState: nextStatus === "active" ? "live" : "cold",
      poll: nextStatus === "active" ? 2 : null
    });
  };

  const saveConfiguration = () => {
    if (qrMode === "fixed" && (!Number.isInteger(Number(qrFixedAmount)) || Number(qrFixedAmount) < 15)) {
      alert("Para precio fijo ingresá un valor entero de al menos $15 (mínimo de Mercado Pago).");
      return;
    }
    onUpdateMachine(m.id, {
      pulse_value: Number(pulseValue) || 0,
      pulse_duration_ms: Number(pulseDuration) || 0,
      pulse_gap_ms: Number(pulseGap) || 0,
      arduino_id: arduinoId.trim() || null,
      wifi_ssid: wifiSsid.trim(),
      wifi_user: wifiUser.trim(),
      wifi_password: wifiPassword,
      qr_mode: qrMode,
      ...(qrMode === "fixed" ? { qr_fixed_amount: Number(qrFixedAmount) } : {}),
    });
    setShowWifiPass(false);
    setEditMode(false);
  };

  const handleDelete = () => {
    if (!confirm(`¿Eliminar la máquina "${m.name}" (${m.id})?\n\nSe borran sus pagos, pulsos y eventos del sistema. La caja en Mercado Pago no se toca. Esta acción no se puede deshacer.`)) return;
    onDelete(m.id);
  };

  const regenerateApiKey = () => {
    const randomHex = Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('');
    onUpdateMachine(m.id, {
      api_key: `tv_live_${randomHex}`
    });
  };

  return (
    <div className="page" data-screen-label="02 Máquina · Detalle">
      <div className="detail-head">
        <div>
          <button className="back-link" onClick={onBack}>{Icon.chev} Volver a Máquinas</button>
          <div className="detail-title-row">
            <h1 className="detail-title">{m.name}</h1>
            <span className={"spill " + conn.dot}>
              <span style={{width:6,height:6,borderRadius:99,background:"currentColor",opacity:.6,display:"inline-block",marginRight:6}}></span>
              {conn.txt}
            </span>
            {m.pollState === "live" && (
              <span className="pill live" style={{ marginLeft: 8 }}><span className="d"></span>polling live</span>
            )}
          </div>
          <div className="detail-meta">
            <span className="mono">{m.id}</span>
            <span className="sep">·</span>
            <span>{m.model}</span>
            <span className="sep">·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--ink-4)", display: "inline-flex" }}>{Icon.pin}</span>
              {m.location}, {m.address}
            </span>
            <span className="sep">·</span>
            <span>Instalada el {new Date(m.created).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn" onClick={onRefresh}>{Icon.refresh} Refrescar</button>
          <button className="btn" onClick={toggleStatus}>
            {m.status === "active" ? (
              <><span style={{display:"inline-flex",alignItems:"center",marginRight:4}}>{Icon.pause}</span>Poner en mantenimiento</>
            ) : (
              <><span style={{display:"inline-flex",alignItems:"center",marginRight:4}}>{Icon.play}</span>Reactivar</>
            )}
          </button>
          {editMode ? (
            <button className="btn primary" onClick={saveConfiguration}>{Icon.check} Guardar configuración</button>
          ) : (
            <button className="btn primary" onClick={() => setEditMode(true)}>{Icon.edit} Editar configuración</button>
          )}
          {!editMode && (
            <button className="danger" onClick={handleDelete} title="Eliminar esta máquina">
              {Icon.trash} Eliminar
            </button>
          )}
        </div>
      </div>

      <div className="detail-strip">
        <div className="item">
          <span className="label">Última señal</span>
          <span className="value">{timeAgo(m.last_seen_at)}</span>
          <span className="delta-row">
            <span className={"delta " + (conn.dot === "ok" ? "up" : conn.dot === "warn" ? "up flat" : "down")}>
              <span className={"sdot " + conn.dot} style={{ marginRight: 5 }}></span>{conn.txt}
            </span>
          </span>
        </div>
        <div className="item">
          <span className="label">Señal WiFi</span>
          <span className="value">{m.last_rssi != null ? `${m.last_rssi} dBm` : "—"}</span>
          <span className="delta-row">
            <span style={{ color: "var(--ink-3)" }}>{wifiQuality(m.last_rssi)}</span>
          </span>
        </div>
        <div className="item">
          <span className="label">Uptime</span>
          <span className="value">{fmtUptime(m.last_uptime)}</span>
          <span className="delta-row">
            <span style={{ color: "var(--ink-3)" }}>desde el último reinicio</span>
          </span>
        </div>
        <div className="item">
          <span className="label">Firmware</span>
          <span className="value mono">{m.firmware_version || "—"}</span>
          <span className="delta-row">
            <span style={{ color: "var(--ink-3)" }}>versión reportada</span>
          </span>
        </div>
      </div>

      <div className="tabs tabs-detail" style={{ marginTop: 18, marginBottom: 18 }}>
        <button className={tab === "config" ? "on" : ""} onClick={() => setTab("config")}>Configuración</button>
        <button className={tab === "pagos" ? "on" : ""} onClick={() => setTab("pagos")}>Pagos</button>
        <button className={tab === "pulsos" ? "on" : ""} onClick={() => setTab("pulsos")}>Pulsos</button>
        <button className={tab === "eventos" ? "on" : ""} onClick={() => setTab("eventos")}>Eventos</button>
      </div>

      {tab === "pagos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Tageo MP */}
          <TageoCard m={m} onRefresh={onRefresh} />
          <PaymentsCard machineId={m.id} />
        </div>
      )}

      {tab === "pulsos" && <PulsesCard machineId={m.id} />}

      {tab === "eventos" && <EventsCard machineId={m.id} />}

      {tab === "config" && (
      <div className="detail-grid">
        {/* LEFT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* La máquina pertenece a la organización activa (selector del topbar);
              no hay traspasos de máquinas entre clientes. */}

          {/* Configuración (precios y pulsos) */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Configuración</div>
                <div className="card-sub">Precio del QR y valor del pulso por máquina</div>
              </div>
            </div>
            <div className="card-body">
              {/* Precio del QR de MP: toggle. ON = fijo (el QR queda cargado con
                  el valor); OFF = dinámico (el cliente tipea el monto). */}
              <div className="kv">
                <span className="k">Precio fijo del QR</span>
                <div className="v v-edit" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className={"switch " + (qrMode === "fixed" ? "on" : "")}
                    onClick={() => setQrMode(qrMode === "fixed" ? "dynamic" : "fixed")}
                    disabled={!editMode}
                    title={qrMode === "fixed" ? "Fijo — el QR muestra el precio cargado" : "Libre — el cliente elige el monto"}
                  />
                  <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
                    {qrMode === "fixed" ? "Fijo" : "Libre (lo elige el cliente)"}
                  </span>
                </div>
              </div>
              {qrMode === "fixed" && (
                <div className="kv">
                  <span className="k">Valor fijo</span>
                  <div className="v v-edit">
                    <span style={{ color: "var(--ink-4)" }}>$</span>
                    <input
                      type="number"
                      min="15"
                      value={qrFixedAmount}
                      onChange={(e) => setQrFixedAmount(e.target.value)}
                      disabled={!editMode}
                      placeholder="Ej: 500"
                      style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                    />
                    <span style={{ color: "var(--ink-4)", fontSize: 11 }}>ARS</span>
                  </div>
                </div>
              )}
              <div className="kv">
                <span className="k">Valor Pulso</span>
                <div className="v v-edit">
                  <span style={{ color: "var(--ink-4)" }}>$</span>
                  <input
                    type="number"
                    value={pulseValue}
                    onChange={(e) => setPulseValue(e.target.value)}
                    disabled={!editMode}
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>ARS</span>
                </div>
              </div>
              <div className="kv">
                <span className="k">Tiempo de pulso</span>
                <div className="v v-edit">
                  <input
                    type="number"
                    value={pulseDuration}
                    onChange={(e) => setPulseDuration(e.target.value)}
                    disabled={!editMode}
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>ms</span>
                </div>
              </div>
              <div className="kv">
                <span className="k">Distancia de pulso</span>
                <div className="v v-edit">
                  <input
                    type="number"
                    value={pulseGap}
                    onChange={(e) => setPulseGap(e.target.value)}
                    disabled={!editMode}
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* QR imprimible de la máquina */}
          <MachineQRCard m={m} />

        </div>

        {/* RIGHT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* WiFi — propia de la máquina; el Arduino la poolea para conectarse.
              Solo editable en modo edición; se guarda con "Guardar configuración". */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{Icon.wifi} Red WiFi</div>
                <div className="card-sub">La red que el Arduino de esta máquina poolea para conectarse.</div>
              </div>
            </div>
            <div className="card-body">
              <div className="kv">
                <span className="k">Nombre WiFi</span>
                <div className="v v-edit">
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    disabled={!editMode}
                    placeholder={editMode ? "Ej: HospitalGuest" : "—"}
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                </div>
              </div>
              <div className="kv">
                <span className="k">Contraseña</span>
                <div className="v v-edit">
                  <input
                    type={showWifiPass ? "text" : "password"}
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    disabled={!editMode}
                    placeholder={editMode ? "••••••••" : "—"}
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                  {editMode && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setShowWifiPass(v => !v)}
                      style={{ marginLeft: 6, fontSize: 11 }}
                    >
                      {showWifiPass ? "ocultar" : "ver"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Firmware */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Firmware & polling</div>
                <div className="card-sub">Arduino + módulo de conexión</div>
              </div>
            </div>
            <div className="card-body">
              <div className="kv">
                <span className="k">Serial de placa <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· ID Arduino</span></span>
                <div className="v v-edit">
                  <input
                    type="text"
                    value={arduinoId}
                    onChange={(e) => setArduinoId(e.target.value)}
                    disabled={!editMode}
                    placeholder="ej: 3C71BF4A2B08"
                    className="mono"
                    style={editMode ? { border: "1px solid var(--line-active)", background: "var(--bg-2)" } : {}}
                  />
                </div>
              </div>
              <div className="kv">
                <span className="k">Versión</span>
                <div className="v mono">{m.firmware}</div>
              </div>
              <div className="kv">
                <span className="k">Hardware</span>
                <div className="v" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{Icon.cpu} ESP32 + WiFi</div>
              </div>
              <div className="kv">
                <span className="k">Polling</span>
                <div className="v" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{Icon.signal} cada 3 s</span>
                  <span className={"spill " + (m.pollState === "live" ? "ok" : m.pollState === "cold" ? "off" : "bad")}>
                    {m.pollState === "live" ? "live" : m.pollState === "cold" ? "frío" : "sin señal"}
                  </span>
                </div>
              </div>
              <div className="kv">
                <span className="k">Último poll</span>
                <div className="v mono">{m.poll == null ? "—" : `hace ${m.poll} s`}</div>
              </div>
            </div>
          </div>

        </div>
      </div>
      )}
    </div>
  );
}

/* ---------- New Machine Modal ---------- */
function NewMachineModal({ onClose, onAdd }) {
  // La máquina nueva queda en la organización activa (no hay traspasos).
  const { orgId } = useAuth();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [serial, setSerial] = useState("");

  // La caja de MP ya no se elige a mano: al crear la máquina, el backend genera
  // (o reutiliza) el local default y le crea una caja propia, y la asocia sola.
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const randHex = (n) => Array.from({length: n}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const machineNum = String(Math.floor(Math.random() * 900) + 100);
    const id = "machine_" + machineNum;
    onAdd({
      id,
      name: name.trim(),
      model: model.trim() || "—",
      location: location.trim() || "—",
      address: address.trim() || "—",
      arduino_id: serial.trim() || null,
      client_id: orgId || null,
      terminal_id: "",
      pulse_value: 250, pulse_multiplier: 1.0, min_payment: 200,
      channels: [null, null, null, null, null],
      api_key: `tv_live_${randHex(16)}`,
      status: "inactive", poll: null, pollState: "cold",
      pulsesToday: 0, rev: 0, rev30: 0, payments: 0,
      firmware: "—",
      created: new Date().toISOString().slice(0, 10),
      last_payment: "—",
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">Nueva máquina</div>
            <div className="modal-sub">Registrá el equipo y su placa — la caja de Mercado Pago se genera sola</div>
          </div>
          <button className="modal-close" onClick={onClose}>{Icon.x}</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">

            {/* Equipo */}
            <div className="form-section">
              <div className="form-section-label">Equipo</div>
              <div className="form-row-2">
                <div className="form-field">
                  <label>Nombre <span className="req">*</span></label>
                  <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="ej: Brio up · Recepción"
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Modelo</label>
                  <input
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="ej: Brio Up"
                  />
                </div>
              </div>
              <div className="form-row-2">
                <div className="form-field">
                  <label>Sede</label>
                  <input
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="ej: Hospital Italiano"
                  />
                </div>
                <div className="form-field">
                  <label>Dirección</label>
                  <input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="ej: Av. Pueyrredón 1640, CABA"
                  />
                </div>
              </div>
            </div>

            {/* Placa */}
            <div className="form-section">
              <div className="form-section-label">Placa · Arduino / ESP32</div>
              <div className="form-field">
                <label>Serial de placa <span className="req">·</span> ID Arduino</label>
                <div className="input-wrap">
                  <span className="lead-icon">{Icon.cpu}</span>
                  <input
                    className="mono"
                    value={serial}
                    onChange={e => setSerial(e.target.value)}
                    placeholder="ej: 3C71BF4A2B08"
                  />
                </div>
                <div className="form-hint">El chip ID del ESP32. Es el serial de la placa <strong>y a la vez el identificador</strong> que el Arduino manda en cada request para que el servidor sepa de qué máquina es.</div>
              </div>
            </div>

            {/* Caja MP — automática */}
            <div className="form-section">
              <div className="form-section-label">Caja · Mercado Pago</div>
              <div className="mp-notice">
                {Icon.qr || Icon.alert}
                <div>
                  <div className="mn-t">Caja automática</div>
                  <div className="mn-s">
                    Al crear la máquina se genera una caja QR propia dentro del local
                    de Tecnovend y se asocia sola. No hay que elegir nada — el QR queda
                    listo en la solapa <strong>Pagos</strong> de la máquina.
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={!name.trim()}>
              {Icon.plus} Crear máquina
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Connect Mercado Pago Modal (gate de alta) ---------- */
// Si el cliente activo no conectó su cuenta de MP, no se puede crear una máquina
// (la caja vive en la cuenta del cliente). Este pop-up lanza el OAuth de MP.
function ConnectMPModal({ orgId, onClose }) {
  const connect = () => {
    if (!orgId) { alert('Seleccioná un cliente antes de conectar Mercado Pago.'); return; }
    // Navegación de página completa al OAuth de MP (vuelve a /?mp_connected=1).
    window.location.href = `${API_BASE}/api/mp/auth?org=${encodeURIComponent(orgId)}`;
  };
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Conectá Mercado Pago</div>
            <div className="modal-sub">Necesario para crear máquinas de este cliente</div>
          </div>
          <button className="modal-close" onClick={onClose}>{Icon.x}</button>
        </div>
        <div className="modal-body">
          <div className="mp-notice">
            {Icon.alert}
            <div>
              <div className="mn-t">Este cliente todavía no conectó su cuenta de Mercado Pago</div>
              <div className="mn-s">
                La caja QR de cada máquina se crea dentro de la cuenta de MP del cliente.
                Conectá la cuenta una vez y después podés dar de alta todas las máquinas que quieras.
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn primary" onClick={connect}>
            {Icon.qr || Icon.plus} Conectar Mercado Pago
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main Component with State & Router ---------- */
export default function Maquinas() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { orgId } = useAuth();

  const [machines, setMachines] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [envProd, setEnvProd] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showConnectMP, setShowConnectMP] = useState(false);

  const clientsById = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c.name])),
    [clients],
  );

  useEffect(() => {
    let active = true;
    const load = () => apiFetch('/api/machines')
      .then(data => { if (active) setMachines(data.map(normalizeMachine)); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    load();
    const t = setInterval(load, 60000);
    return () => { active = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch('/api/clients')
      .then(data => { if (active) setClients(data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const addMachine = async (newMachine) => {
    try {
      const r = await apiFetch('/api/machines', {
        method: 'POST',
        body: JSON.stringify(newMachine),
      });
      if (r?.mp_error) {
        alert(
          'La máquina se creó, pero no se pudo generar su caja en Mercado Pago:\n\n' +
          r.mp_error +
          '\n\nPodés reintentar desde el detalle de la máquina (solapa Pagos → "Crear nuevo POS").'
        );
      }
      const data = await apiFetch('/api/machines');
      setMachines(data.map(normalizeMachine));
    } catch (e) {
      alert('Error al crear máquina: ' + e.message);
    }
  };

  const refreshMachines = async () => {
    const data = await apiFetch('/api/machines');
    setMachines(data.map(normalizeMachine));
  };

  const deleteMachine = async (machineId) => {
    try {
      await apiFetch(`/api/machines/${machineId}`, { method: 'DELETE' });
      setMachines(prev => prev.filter(m => m.id !== machineId));
      navigate('/maquinas');
    } catch (e) {
      alert('Error al eliminar máquina: ' + e.message);
    }
  };

  // Gate de alta: solo se abre el alta si el cliente activo tiene MP conectado;
  // si no, primero el pop-up para conectar la cuenta.
  const handleNew = async () => {
    try {
      const status = await apiFetch('/api/mp/status');
      if (status?.connected) setShowNewModal(true);
      else setShowConnectMP(true);
    } catch {
      setShowConnectMP(true);
    }
  };

  const updateMachine = async (machineId, updatedFields) => {
    try {
      await apiFetch(`/api/machines/${machineId}`, {
        method: 'PUT',
        body: JSON.stringify(updatedFields),
      });
      setMachines(prev => prev.map(m =>
        m.id === machineId ? { ...m, ...updatedFields } : m
      ));
    } catch (e) {
      alert('Error al actualizar máquina: ' + e.message);
    }
  };

  const crumbs = id
    ? ["Operación", <span key="m" onClick={() => navigate('/maquinas')} style={{ cursor: "pointer" }}>Máquinas</span>, id]
    : ["Operación", "Máquinas"];

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar
          envProd={envProd}
          onEnvToggle={() => setEnvProd(p => !p)}
          crumbs={crumbs}
        />
        {id ? (
          <MachineDetail
            id={id}
            machines={machines}
            onBack={() => navigate('/maquinas')}
            onUpdateMachine={updateMachine}
            onRefresh={refreshMachines}
            onDelete={deleteMachine}
          />
        ) : loading ? (
          <div style={{ padding: 40, color: 'var(--ink-3)' }}>Cargando máquinas…</div>
        ) : (
          <MachineList
            machines={machines}
            clientsById={clientsById}
            onOpen={(mid) => navigate(`/maquinas/${mid}`)}
            onNew={handleNew}
          />
        )}
        {showNewModal && (
          <NewMachineModal
            onClose={() => setShowNewModal(false)}
            onAdd={addMachine}
          />
        )}
        {showConnectMP && (
          <ConnectMPModal
            orgId={orgId}
            onClose={() => setShowConnectMP(false)}
          />
        )}
      </div>
    </div>
  );
}

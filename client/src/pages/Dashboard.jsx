import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';

/* ---------- Helpers ---------- */
const ars = (n) => "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const num = (n) => n.toLocaleString("es-AR");

/* ---------- Sparkline ---------- */
function Spark({ data, color = "#18181b", w = 88, h = 36, fill }) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return [x, y];
  });
  const d = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const dFill = d + ` L ${w},${h} L 0,${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={dFill} fill={fill} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- KPI ---------- */
function KPI({ label, ico, value, unit, delta, deltaDir = "up", note, spark, sparkFill, sparkColor }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        <span className="ico">{ico}</span>
        {label}
      </div>
      <div className="kpi-value mono">
        {unit && <span className="unit">{unit}</span>}{value}
      </div>
      <div className="kpi-foot">
        {delta && (
          <span className={"delta " + deltaDir}>
            {deltaDir === "up" ? Icon.arrowUp : deltaDir === "down" ? Icon.arrowDown : null}
            {delta}
          </span>
        )}
        <span>{note}</span>
      </div>
      {spark && <Spark data={spark} color={sparkColor || "#18181b"} fill={sparkFill} />}
    </div>
  );
}

/* ---------- Revenue chart ---------- */
function RevenueChart() {
  const days = 30;
  const seedA = [42,38,45,52,48,55,61,58,67,72,68,75,82,78,85,90,86,94,101,97,104,110,107,115,122,118,126,133,129,138];
  const seedB = [28,25,30,34,31,36,40,38,44,48,45,50,55,52,57,61,58,64,69,66,71,76,73,79,84,81,87,92,89,95];

  const [hover, setHover] = useState(null);
  const W = 720, H = 240, padL = 0, padR = 0, padT = 14, padB = 28;
  const max = Math.max(...seedA) * 1.15;
  const xs = (i) => padL + (i / (days - 1)) * (W - padL - padR);
  const ys = (v) => padT + (1 - v / max) * (H - padT - padB);
  const linePath = (arr) => arr.map((v, i) => (i ? "L" : "M") + xs(i).toFixed(1) + "," + ys(v).toFixed(1)).join(" ");
  const areaPath = (arr) => linePath(arr) + ` L ${xs(days - 1)},${H - padB} L ${xs(0)},${H - padB} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="240" preserveAspectRatio="none"
         onMouseMove={(e) => {
           const r = e.currentTarget.getBoundingClientRect();
           const x = ((e.clientX - r.left) / r.width) * W;
           const i = Math.max(0, Math.min(days - 1, Math.round((x / W) * (days - 1))));
           setHover(i);
         }}
         onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="gA" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#c2410c" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1="0" x2={W} y1={padT + p * (H - padT - padB)} y2={padT + p * (H - padT - padB)} stroke="#f1f1ee" strokeDasharray="3 4" />
      ))}
      <path d={linePath(seedB)} fill="none" stroke="#a1a1aa" strokeWidth="1.4" strokeDasharray="3 4" />
      <path d={areaPath(seedA)} fill="url(#gA)" />
      <path d={linePath(seedA)} fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" />
      <circle cx={xs(days - 1)} cy={ys(seedA[days - 1])} r="3.5" fill="#c2410c" stroke="#fff" strokeWidth="2" />

      {hover !== null && (
        <g>
          <line x1={xs(hover)} x2={xs(hover)} y1={padT} y2={H - padB} stroke="#18181b" strokeWidth="0.8" strokeDasharray="2 3" />
          <circle cx={xs(hover)} cy={ys(seedA[hover])} r="4" fill="#c2410c" stroke="#fff" strokeWidth="2" />
          <g transform={`translate(${Math.min(xs(hover) + 10, W - 110)}, ${Math.max(ys(seedA[hover]) - 38, 8)})`}>
            <rect width="100" height="34" rx="6" fill="#18181b" />
            <text x="8" y="14" fontSize="10" fill="#a1a1aa" fontFamily="Geist Mono">Día {hover + 1}</text>
            <text x="8" y="27" fontSize="12" fontWeight="500" fill="#fff" fontFamily="Geist Mono">$ {(seedA[hover]*1000).toLocaleString("es-AR")}</text>
          </g>
        </g>
      )}

      {[0, 7, 14, 21, 28].map((d, i) => (
        <text key={i} x={xs(d)} y={H - 8} fontSize="10.5" fill="#a1a1aa" fontFamily="Geist Mono" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>
          {["1 may", "8 may", "15 may", "22 may", "29 may"][i]}
        </text>
      ))}
    </svg>
  );
}

/* ---------- Payment methods mix ---------- */
function MethodsMix() {
  const methods = [
    { key: "qr",    label: "QR · Mercado Pago",  count: 847, amount: 712400, color: "#00b1ea", pct: 66 },
    { key: "card",  label: "Tarjeta · MP Point", count: 312, amount: 348900, color: "#18181b", pct: 24 },
    { key: "other", label: "Otros / efectivo",   count: 125, amount: 102300, color: "#d4d4d8", pct: 10 },
  ];
  const total = methods.reduce((s, m) => s + m.amount, 0);
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--line-2)", marginBottom: 18 }}>
        {methods.map((m, i) => (
          <div key={i} style={{ width: m.pct + "%", background: m.color }} title={m.label} />
        ))}
      </div>
      {methods.map((m, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 12, alignItems: "center", padding: "10px 0", borderTop: i ? "1px solid var(--line-2)" : 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-1)" }}>{m.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }} className="mono">{num(m.count)} pagos · {m.pct}% del volumen</div>
          </div>
          <div className="mono" style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 500, textAlign: "right" }}>{ars(m.amount)}</div>
        </div>
      ))}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Volumen acreditado · 30 días</span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>{ars(total)}</span>
      </div>
    </div>
  );
}

/* ---------- Machines list ---------- */
const machines = [
  { name: "Brio up · Lobby",        loc: "Hospital Italiano",      sub: "Av. Pueyrredón 1640, CABA",   id: "machine_001", terminal: "PAX-A920 · 8f3a", channels: 5, status: "active",      poll: "2 s",  pulsesToday: 142, rev: 48230 },
  { name: "Kikko snacky · Piso 4",  loc: "Universidad Austral",     sub: "Pilar, BA",                  id: "machine_007", terminal: "QR · pos_4421",   channels: 4, status: "active",      poll: "1 s",  pulsesToday: 118, rev: 37410 },
  { name: "Concerto · Cafetería",   loc: "Banco Galicia HQ",        sub: "Tte. Gral. Perón 430",       id: "machine_012", terminal: "PAX · 02214",     channels: 5, status: "active",      poll: "3 s",  pulsesToday: 96,  rev: 29870 },
  { name: "Opera tango · RRHH",     loc: "Telecom Argentina",       sub: "Alicia M. de Justo 50",      id: "machine_015", terminal: "QR · pos_1509",   channels: 3, status: "active",      poll: "2 s",  pulsesToday: 84,  rev: 26110 },
  { name: "Solista · Sala docentes",loc: "Colegio Newman",          sub: "Av. del Libertador 17115",   id: "machine_022", terminal: "QR · pos_0642",   channels: 5, status: "maintenance", poll: "—",    pulsesToday: 12,  rev: 8420  },
  { name: "Melodía · Espera",       loc: "Clínica Suizo Argentina", sub: "Av. Pueyrredón 1461",        id: "machine_018", terminal: "PAX · 01088",     channels: 4, status: "active",      poll: "4 s",  pulsesToday: 71,  rev: 24380 },
  { name: "Kikko max · Lobby",      loc: "Edenor — Costanera",      sub: "Av. España 1675",            id: "machine_023", terminal: "QR · pos_2307",   channels: 5, status: "inactive",    poll: "12 m", pulsesToday: 0,   rev: 0     },
  { name: "Kikko black · Aula 3",   loc: "ITBA",                    sub: "Iguazú 341",                 id: "machine_009", terminal: "PAX · 00417",     channels: 5, status: "active",      poll: "1 s",  pulsesToday: 63,  rev: 19260 },
];

const statusMeta = {
  active:      { dot: "ok",   txt: "Activa",       sub: "Polling OK" },
  maintenance: { dot: "warn", txt: "Mantenimiento", sub: "Modo manual" },
  inactive:    { dot: "off",  txt: "Inactiva",     sub: "Sin polling" },
};

function MachinesTable() {
  return (
    <div>
      <div className="machine head">
        <span></span>
        <span>Máquina</span>
        <span>Sede</span>
        <span>Terminal / POS</span>
        <span>Polling</span>
        <span style={{ textAlign: "center" }}>Canales</span>
        <span style={{ textAlign: "right" }}>Pulsos · hoy</span>
        <span style={{ textAlign: "right" }}>Ingresos · hoy</span>
        <span></span>
      </div>
      {machines.map((m, i) => {
        const st = statusMeta[m.status];
        return (
          <div className="machine" key={i}>
            <span className={"status-dot " + st.dot}></span>
            <div className="m-name">
              <span className="n">{m.name}</span>
              <span className="id mono">{m.id}</span>
            </div>
            <div className="m-loc">
              <div>{m.loc}</div>
              <div className="sub">{m.sub}</div>
            </div>
            <div className="m-loc mono" style={{ fontSize: 12 }}>
              <div>{m.terminal}</div>
              <div className="sub">{st.sub}</div>
            </div>
            <div style={{ fontSize: 12.5, color: m.status === "inactive" ? "#b91c1c" : "var(--ink-2)" }} className="mono">
              {m.poll === "—" ? "—" : "hace " + m.poll}
            </div>
            <div style={{ textAlign: "center" }}>
              <span className="ch-pill mono">{m.channels}<span style={{opacity:.4}}>/5</span></span>
            </div>
            <div className="m-revenue mono">{m.pulsesToday}</div>
            <div className="m-revenue mono">{m.rev ? ars(m.rev) : <span style={{color:"var(--ink-4)"}}>—</span>}</div>
            <div className="chev">{Icon.chev}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Pulse queue ---------- */
function PulseQueue() {
  const counters = [
    { k: "pending",   label: "Pendientes",  count: 12, color: "#b45309", bg: "#fef3c7" },
    { k: "delivered", label: "Entregados",  count: 4,  color: "#1d4ed8", bg: "#eff6ff" },
    { k: "acked",     label: "ACK · 5 min", count: 286,color: "#15803d", bg: "#ecfdf5" },
    { k: "expired",   label: "Expirados",   count: 1,  color: "#b91c1c", bg: "#fee2e2" },
  ];

  const items = [
    { id: "p_8f3a92",  machine: "machine_001", channel: 1, count: 2, age: "3 s",  status: "delivered" },
    { id: "p_8f3a91",  machine: "machine_001", channel: 2, count: 1, age: "8 s",  status: "pending" },
    { id: "p_4421aa",  machine: "machine_007", channel: 3, count: 1, age: "14 s", status: "pending" },
    { id: "p_02214b",  machine: "machine_012", channel: 1, count: 2, age: "22 s", status: "pending" },
    { id: "p_1509cc",  machine: "machine_015", channel: 4, count: 1, age: "31 s", status: "pending" },
    { id: "p_01088dd", machine: "machine_018", channel: 2, count: 1, age: "48 s", status: "pending" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {counters.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.bg, borderRadius: 8 }}>
            <div className="mono" style={{ fontSize: 20, fontWeight: 500, color: c.color, letterSpacing: "-0.02em", lineHeight: 1 }}>{c.count}</div>
            <div style={{ fontSize: 11.5, color: c.color, fontWeight: 500 }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase", padding: "4px 0 8px" }}>
        Cola actual · 6 pulsos
      </div>
      {items.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "9px 0", borderTop: i ? "1px solid var(--line-2)" : 0 }}>
          <span className={"q-status " + p.status}></span>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-1)" }}>{p.id}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }} className="mono">
              {p.machine} · ch {p.channel} × {p.count}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>{p.age}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Recent payments (MP) ---------- */
function Payments() {
  const tx = [
    { method: "qr",   prod: "Café espresso",        machine: "machine_001",  amount: 850,  pulses: 2, status: "approved", mpId: "1287456321", time: "10:42:18" },
    { method: "card", prod: "Coca-Cola 354 ml",     machine: "machine_007",  amount: 1200, pulses: 4, status: "approved", mpId: "1287456319", time: "10:41:52" },
    { method: "qr",   prod: "Bon o Bon",            machine: "machine_015",  amount: 450,  pulses: 1, status: "approved", mpId: "1287456314", time: "10:41:30" },
    { method: "qr",   prod: "—",                    machine: "machine_012",  amount: 100,  pulses: 0, status: "rejected", mpId: "1287456310", time: "10:40:11", err: "min_payment" },
    { method: "card", prod: "Té frío Baggio",       machine: "machine_022",  amount: 1100, pulses: 4, status: "approved", mpId: "1287456305", time: "10:39:48" },
    { method: "qr",   prod: "Agua mineral 500ml",   machine: "machine_018",  amount: 800,  pulses: 3, status: "approved", mpId: "1287456301", time: "10:39:02" },
    { method: "card", prod: "Pepitos",              machine: "machine_009",  amount: 950,  pulses: 3, status: "approved", mpId: "1287456298", time: "10:38:21" },
    { method: "qr",   prod: "Capuccino",            machine: "machine_001",  amount: 1050, pulses: 4, status: "pending",  mpId: "1287456295", time: "10:37:55" },
  ];
  return (
    <div>
      <div className="tx head">
        <span></span>
        <span>Pago</span>
        <span>Máquina</span>
        <span style={{ textAlign: "right" }}>Pulsos</span>
        <span style={{ textAlign: "right" }}>Monto</span>
        <span></span>
      </div>
      {tx.map((t, i) => (
        <div className="tx" key={i}>
          <div className={"tx-method " + t.method}>{t.method === "qr" ? Icon.qr : Icon.card}</div>
          <div style={{ minWidth: 0 }}>
            <div className="tx-prod">
              {t.prod}
              <span className={"tx-status " + t.status}>
                {t.status === "approved" && <>{Icon.check} approved</>}
                {t.status === "rejected" && <>{Icon.x} rejected</>}
                {t.status === "pending"  && <>{Icon.clock} pending</>}
              </span>
            </div>
            <div className="tx-meta mono">
              <span>{t.method === "qr" ? "MP · QR" : "MP · Point"}</span>
              <span>·</span>
              <span>mp_{t.mpId}</span>
              {t.err && <><span>·</span><span style={{color:"var(--bad)"}}>{t.err}</span></>}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{t.machine}</div>
          <div className="mono" style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 500, textAlign: "right" }}>{t.pulses || "—"}</div>
          <div>
            <div className="tx-amount mono">{ars(t.amount)}</div>
            <div className="tx-time mono">{t.time}</div>
          </div>
          <div className="chev">{Icon.chev}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- System health ---------- */
function SystemHealth() {
  const stats = [
    { l: "Webhook MP", v: "200 OK", sub: "Avg 142 ms · últimas 24 h", ok: true },
    { l: "Firmas HMAC", v: "100%", sub: "0 rechazadas en 24 h", ok: true },
    { l: "Deduplicaciones", v: "3", sub: "mp_payment_id repetidos", ok: true },
    { l: "Pulsos expirados", v: "1", sub: "ACK > 10 min · machine_022", ok: false },
  ];
  return (
    <div>
      {stats.map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 12, alignItems: "center", padding: "12px 0", borderTop: i ? "1px solid var(--line-2)" : 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.ok ? "#15803d" : "#b45309", boxShadow: s.ok ? "0 0 0 3px rgba(21,128,61,.12)" : "0 0 0 3px rgba(180,83,9,.12)" }} />
          <div>
            <div style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 500 }}>{s.l}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{s.sub}</div>
          </div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-1)" }}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Main Dashboard Component ---------- */
export default function Dashboard() {
  const [period, setPeriod] = useState("30d");
  const [envProd, setEnvProd] = useState(true);
  const periods = [["24h","Hoy"],["7d","7 días"],["30d","30 días"],["90d","90 días"]];

  // ticking clock
  const [now, setNow] = useState(new Date(2026, 4, 22, 10, 42, 18));
  useEffect(() => {
    const t = setInterval(() => setNow(d => new Date(d.getTime() + 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={["Operación", "Dashboard"]} />
        <div className="page" data-screen-label="01 Dashboard">
          <div className="page-head">
            <div>
              <h1 className="page-title">Operación <span className="accent">— jueves 22 de mayo</span></h1>
              <div className="page-subtitle">
                <span className="pill live"><span className="d"></span>Live · {timeStr} ART</span>
                <span style={{ marginLeft: 10 }}>44 de 47 máquinas reportando · webhook MP saludable</span>
              </div>
            </div>
            <div className="head-controls">
              <div className="seg">
                {periods.map(([k, l]) => (
                  <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>
                ))}
              </div>
              <button className="btn" title="Recargar">{Icon.refresh}</button>
            </div>
          </div>

          {/* KPIs */}
          <div className="kpi-row">
            <KPI
              label="Ingresos · hoy"
              ico={Icon.coin}
              unit="$"
              value="284.910"
              delta="+18,2%"
              deltaDir="up"
              note="vs. ayer mismo horario"
              spark={[12,14,13,18,22,20,28,32,30,38,42,48,55,58]}
              sparkColor="#c2410c"
            />
            <KPI
              label="Pagos aprobados"
              ico={Icon.card}
              value="1.284"
              delta="+12,4%"
              deltaDir="up"
              note="847 QR · 312 tarjeta · 22 rech."
              spark={[20,24,22,26,30,28,34,38,36,42,46,50,54,58]}
              sparkColor="#18181b"
            />
            <KPI
              label="Pulsos · cola viva"
              ico={Icon.pulse}
              value="12"
              delta="4,2 s"
              deltaDir="flat"
              note="latencia media pago→ACK"
              spark={[8,11,9,14,10,13,15,12,16,11,14,12,10,12]}
              sparkColor="#b45309"
            />
            <KPI
              label="Máquinas online"
              ico={Icon.machine}
              value="44"
              delta="3 offline"
              deltaDir="down"
              note="de 47 · 1 en mantenimiento"
              spark={[44,45,45,46,46,47,47,46,46,47,45,44,44,44]}
              sparkColor="#18181b"
            />
          </div>

          {/* Chart + Methods */}
          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Ingresos · últimos 30 días</div>
                  <div className="card-sub">Comparado con período anterior</div>
                </div>
                <div className="card-actions">
                  <span className="pill"><span className="d"></span>Todas las máquinas</span>
                  <button className="link-btn">Ver reporte{Icon.ext}</button>
                </div>
              </div>
              <div className="chart-summary">
                <div className="stat">
                  <span className="l">Total período</span>
                  <span className="v mono">$ 6.842.300</span>
                </div>
                <div className="stat">
                  <span className="l">Pago promedio</span>
                  <span className="v mono">$ 942</span>
                </div>
                <div className="stat">
                  <span className="l">Pulsos entregados</span>
                  <span className="v mono">7.264</span>
                </div>
                <div className="stat">
                  <span className="l">Tasa de aprobación</span>
                  <span className="v mono">98,3%</span>
                </div>
              </div>
              <div className="chart-legend">
                <span className="key"><span className="swatch" style={{ background: "#c2410c" }}></span>Período actual</span>
                <span className="key"><span className="swatch" style={{ background: "#a1a1aa" }}></span>Período anterior</span>
              </div>
              <div className="chart-wrap">
                <RevenueChart />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Métodos de pago</div>
                  <div className="card-sub">QR vs Point · 30 días</div>
                </div>
                <button className="link-btn">Detalle{Icon.chev}</button>
              </div>
              <div className="card-body">
                <MethodsMix />
              </div>
            </div>
          </div>

          {/* Machines + Pulse queue */}
          <div className="grid-3">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Máquinas</div>
                  <div className="card-sub">47 equipos · ordenado por actividad de hoy</div>
                </div>
                <div className="card-actions">
                  <span className="pill" style={{ color: "#15803d", background: "#ecfdf5", borderColor: "#d1fae5" }}>● 44 activas</span>
                  <span className="pill" style={{ color: "#b45309", background: "#fef3c7", borderColor: "#fde68a" }}>● 1 mant.</span>
                  <span className="pill" style={{ color: "#b91c1c", background: "#fee2e2", borderColor: "#fecaca" }}>● 2 offline</span>
                  <button className="link-btn">Ver flota{Icon.chev}</button>
                </div>
              </div>
              <MachinesTable />
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Cola de pulsos</div>
                  <div className="card-sub">pulse_queue · últimos 5 min</div>
                </div>
                <span className="pill live"><span className="d"></span>live</span>
              </div>
              <div className="card-body">
                <PulseQueue />
              </div>
            </div>
          </div>

          {/* Payments + System health */}
          <div className="grid-3">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Pagos · Mercado Pago</div>
                  <div className="card-sub">Webhook IPN · últimos minutos</div>
                </div>
                <div className="card-actions">
                  <span className="pill"><span className="d"></span>Todos los métodos</span>
                  <button className="link-btn">Historial completo{Icon.chev}</button>
                </div>
              </div>
              <Payments />
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Salud del sistema</div>
                  <div className="card-sub">Webhook, firmas, dedup · 24 h</div>
                </div>
                <button className="link-btn">Logs{Icon.ext}</button>
              </div>
              <div className="card-body">
                <SystemHealth />
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center", padding: "8px 0 0", color: "var(--ink-4)", fontSize: 11.5, letterSpacing: "0.04em" }}>
            Tecnovend · Vending OS · v1.0 — Dashboard preview · entorno {envProd ? "producción" : "sandbox"}
          </div>
        </div>
      </div>
    </div>
  );
}

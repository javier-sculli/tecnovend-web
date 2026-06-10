import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';

/* ---------- Helpers ---------- */
const ars = (n) => "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const num = (n) => n.toLocaleString("es-AR");

/* ============================================================
   Empty state — not connected
   ============================================================ */
function EmptyState({ onConnect, connecting }) {
  return (
    <div className="mp-empty">
      <div className="left">
        <span className="eyebrow"><span className="dot"></span>Integración · Mercado Pago</span>
        <h2>Conecta Mercado Pago <span className="it">para empezar a cobrar</span></h2>
        <p>Autorizá a Tecnovend a procesar pagos en nombre de tu cuenta. Te llevamos a Mercado Pago, te autenticás una sola vez y volvés acá con tus locales y terminales sincronizados.</p>

        <div className="perks">
          <div className="perk">{Icon.check}<span><b>Pagos QR + Point</b> usando tus credenciales reales, sin intermediarios.</span></div>
          <div className="perk">{Icon.check}<span><b>Webhooks automáticos</b> — los pagos aprobados se acreditan al instante.</span></div>
          <div className="perk">{Icon.check}<span><b>Locales y POS</b> se importan solos. Solo elegís qué máquina vincular a qué.</span></div>
          <div className="perk">{Icon.check}<span><b>Revocable en un click</b> desde tu cuenta de Mercado Pago.</span></div>
        </div>

        <button
          className={"btn-mp " + (connecting ? "loading" : "")}
          onClick={() => !connecting && onConnect()}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <span className="spinner"></span>
              Redirigiendo a Mercado Pago…
            </>
          ) : (
            <>
              <span className="mp-logo">MP</span>
              Conectar con Mercado Pago
              {Icon.arr}
            </>
          )}
        </button>
        <div className="mp-secure">
          {Icon.shield}
          Conexión OAuth · OAuth 2.0 · solo lectura de cuenta + creación de pagos
        </div>
      </div>

      <div className="mp-illust" aria-hidden>
        <div className="conn-line">
          <svg viewBox="0 0 400 320" preserveAspectRatio="none">
            <defs>
              <pattern id="dash" patternUnits="userSpaceOnUse" width="6" height="6">
                <line x1="0" y1="3" x2="3" y2="3" stroke="#d4d4d8" strokeWidth="1"/>
              </pattern>
            </defs>
            <path d="M 100 60 Q 200 30 300 60" stroke="#d4d4d8" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
            <path d="M 100 70 Q 100 200 200 260" stroke="#d4d4d8" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
            <path d="M 300 70 Q 300 200 200 260" stroke="#d4d4d8" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
          </svg>
        </div>
        <div className="flow-card tn">
          <div className="ico-box">
            {Icon.machine}
          </div>
          <div>
            <div className="name">Tecnovend</div>
            <div className="sub">vending_os</div>
          </div>
        </div>
        <div className="flow-card mp">
          <div className="ico-box">MP</div>
          <div>
            <div className="name">Mercado Pago</div>
            <div className="sub">tu cuenta</div>
          </div>
        </div>
        <div className="flow-card store">
          <div className="ico-box">{Icon.building}</div>
          <div>
            <div className="name">Tus locales</div>
            <div className="sub">3 locales · 6 POS</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Redirect overlay — between click and connected state
   ============================================================ */
function RedirectOverlay() {
  return (
    <div className="redirect-overlay">
      <div className="redirect-card">
        <div className="mp-mark">MP</div>
        <h3>Redirigiendo a Mercado Pago</h3>
        <p>Te estamos llevando a la pantalla de autorización oficial de MP. Volverás acá automáticamente.</p>
        <span className="url">https://auth.mercadopago.com.ar/authorization?…</span>
      </div>
    </div>
  );
}

/* ============================================================
   Connected state — account + stores + devices
   ============================================================ */
const ACCOUNT = {
  name: "Tecnovend SA",
  email: "pagos@tecnovend.com.ar",
  mp_user_id: "284910742",
  connected_at: "22 mayo · 10:34",
  expires: "21 may 2027",
};

const STORES = [
  {
    id: "store_8821",
    name: "Hospital Italiano — Lobby",
    address: "Av. Pueyrredón 1640, CABA",
    pos: 2, point: 1, machines: 2,
  },
  {
    id: "store_5544",
    name: "Universidad Austral — Campus Pilar",
    address: "Av. Juan D. Perón 1500, Pilar",
    pos: 1, point: 0, machines: 1,
  },
  {
    id: "store_3309",
    name: "Banco Galicia — HQ",
    address: "Tte. Gral. Perón 430, CABA",
    pos: 0, point: 2, machines: 2,
  },
  {
    id: "store_7720",
    name: "Telecom — Puerto Madero",
    address: "Alicia M. de Justo 50, CABA",
    pos: 1, point: 1, machines: 2,
  },
];

const DEVICES = [
  { type: "qr",    id: "pos_4421",   label: "Caja QR principal",  store: "Hospital Italiano",  machine: "machine_001" },
  { type: "qr",    id: "pos_4422",   label: "Caja QR planta baja", store: "Hospital Italiano", machine: null },
  { type: "point", id: "PAX-A920-8f3a92", label: "Point Pro · 8f3a92", store: "Hospital Italiano", machine: "machine_001" },
  { type: "qr",    id: "pos_5501",   label: "Caja QR cafetería",  store: "Universidad Austral", machine: "machine_007" },
  { type: "point", id: "PAX-A920-02214b", label: "Point Pro · 02214b", store: "Banco Galicia HQ", machine: "machine_012" },
  { type: "point", id: "PAX-A920-31aa44", label: "Point Mini · 31aa44", store: "Banco Galicia HQ", machine: null },
  { type: "qr",    id: "pos_1509",   label: "Caja QR oficinas",   store: "Telecom",            machine: "machine_015" },
  { type: "point", id: "PAX-A920-01088c", label: "Point Pro · 01088c", store: "Telecom",       machine: "machine_018" },
];

function ConnectedState({ onDisconnect }) {
  const totalPos = STORES.reduce((s, st) => s + st.pos, 0);
  const totalPoint = STORES.reduce((s, st) => s + st.point, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Account header */}
      <div className="mp-account">
        <div className="badge">MP</div>
        <div className="info">
          <div className="name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {ACCOUNT.name}
            <span className="verified" title="Conexión verificada" style={{ display: "inline-flex", color: "var(--ok)" }}>{Icon.check}</span>
            <span className="spill ok" style={{ marginLeft: 6 }}>conectado</span>
          </div>
          <div className="meta">
            <span>{ACCOUNT.email}</span>
            <span className="sep">·</span>
            <span className="mono">user_id: {ACCOUNT.mp_user_id}</span>
            <span className="sep">·</span>
            <span>conectada hoy {ACCOUNT.connected_at}</span>
            <span className="sep">·</span>
            <span>token vence {ACCOUNT.expires}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">{Icon.refresh} Sincronizar locales</button>
          <button className="danger" onClick={onDisconnect}>{Icon.unplug} Desconectar</button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="detail-strip">
        <div className="item">
          <span className="label">Locales</span>
          <span className="value">{STORES.length}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">stores en tu cuenta MP</span>
        </div>
        <div className="item">
          <span className="label">Cajas QR · POS</span>
          <span className="value">{totalPos}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">{DEVICES.filter(d => d.type === "qr" && d.machine).length} vinculadas a máquinas</span>
        </div>
        <div className="item">
          <span className="label">Terminales Point</span>
          <span className="value">{totalPoint}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">{DEVICES.filter(d => d.type === "point" && d.machine).length} vinculadas a máquinas</span>
        </div>
        <div className="item">
          <span className="label">Webhook IPN</span>
          <span className="value" style={{ color: "var(--ok)" }}>200 OK</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">avg 142 ms · últimas 24 h</span>
        </div>
      </div>

      {/* Locales */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Locales</div>
            <div className="card-sub">Sucursales registradas en tu cuenta de Mercado Pago · sincronizadas hace 4 s</div>
          </div>
          <div className="card-actions">
            <button className="link-btn">{Icon.refresh} Sincronizar</button>
            <button className="link-btn">Ver en MP{Icon.ext}</button>
          </div>
        </div>
        <div className="locale-list">
          <div className="locale head">
            <span></span>
            <span>Local</span>
            <span>Cajas QR</span>
            <span>Point</span>
            <span>Máquinas vinculadas</span>
            <span></span>
          </div>
          {STORES.map(s => (
            <div className="locale" key={s.id}>
              <div className="locale-ico">{Icon.building}</div>
              <div className="locale-name">
                <span className="n">{s.name}</span>
                <span className="addr" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{Icon.pin} {s.address}</span>
              </div>
              <div className="locale-stat">{Icon.qr}<span className="v">{s.pos}</span></div>
              <div className="locale-stat">{Icon.card}<span className="v">{s.point}</span></div>
              <div className="locale-stat" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {Icon.machine}
                <span className="v">{s.machines}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 4 }} className="mono">de {s.pos + s.point} posibles</span>
              </div>
              <button className="actions-menu">{Icon.more}</button>
            </div>
          ))}
        </div>
      </div>

      {/* Devices / POS */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">POS · QR & Terminales Point</div>
            <div className="card-sub">Vinculá cada dispositivo a una máquina para activar los pagos</div>
          </div>
          <div className="card-actions">
            <span className="pill">{DEVICES.length} dispositivos</span>
            <button className="link-btn">{Icon.plus} Crear caja QR</button>
          </div>
        </div>
        <div className="dev-list">
          <div className="dev-row head">
            <span></span>
            <span>Dispositivo</span>
            <span>Local</span>
            <span>Vinculado a</span>
            <span>Estado</span>
            <span></span>
          </div>
          {DEVICES.map(d => (
            <div className="dev-row" key={d.id}>
              <div className={"ico " + d.type}>{d.type === "qr" ? Icon.qr : Icon.card}</div>
              <div className="name-cell">
                <span className="n">{d.label}</span>
                <span className="mono">{d.id}</span>
              </div>
              <div style={{ color: "var(--ink-2)" }}>{d.store}</div>
              <div>
                {d.machine ? (
                  <span className="machine-tag">{Icon.machine}{d.machine}</span>
                ) : (
                  <span className="machine-tag empty">{Icon.plus} sin vincular</span>
                )}
              </div>
              <div>
                {d.machine ? (
                  <span className="spill ok">{Icon.check} activo</span>
                ) : (
                  <span className="spill warn">pendiente</span>
                )}
              </div>
              <button className="actions-menu">{Icon.more}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   App entry
   ============================================================ */
export default function Pagos() {
  const [envProd, setEnvProd] = useState(false);
  const [state, setState] = useState(() => {
    return localStorage.getItem("tecnovend_mp_connected") === "true" ? "connected" : "empty";
  });
  const [showRedirect, setShowRedirect] = useState(false);

  const connect = () => {
    setState("connecting");
    setShowRedirect(true);
    // Simulate MP OAuth round-trip
    setTimeout(() => {
      setShowRedirect(false);
      setState("connected");
      localStorage.setItem("tecnovend_mp_connected", "true");
    }, 2200);
  };

  const disconnect = () => {
    if (confirm("¿Desconectar la cuenta de Mercado Pago? Vas a tener que reautorizar para volver a cobrar.")) {
      setState("empty");
      localStorage.removeItem("tecnovend_mp_connected");
    }
  };

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar
          envProd={envProd}
          onEnvToggle={() => setEnvProd(p => !p)}
          crumbs={["Operación", "Pagos · Mercado Pago"]}
        />
        <div className="page" data-screen-label={state === "connected" ? "02 Pagos · MP conectado" : "01 Pagos · MP conectar"}>
          <div className="page-head">
            <div>
              <h1 className="page-title">
                Pagos · Mercado Pago
                {state === "connected" && <span className="accent"> — cuenta vinculada</span>}
                {state !== "connected" && <span className="accent"> — autorizá tu cuenta</span>}
              </h1>
              <div className="page-subtitle">
                {state === "connected"
                  ? "Tus locales, cajas QR y terminales Point sincronizan automáticamente."
                  : "Una sola autorización OAuth conecta toda tu operación."}
              </div>
            </div>
          </div>

          {state === "connected"
            ? <ConnectedState onDisconnect={disconnect} />
            : <EmptyState onConnect={connect} connecting={state === "connecting"} />
          }
        </div>
        {showRedirect && <RedirectOverlay />}
      </div>
    </div>
  );
}

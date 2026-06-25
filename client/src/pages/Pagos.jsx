import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { apiFetch, API_BASE } from '../api.js';
import { useAuth } from '../auth.jsx';

/* ---------- Helpers ---------- */
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

const storeAddress = (s) =>
  s?.location?.address_line ||
  [s?.location?.street_name, s?.location?.street_number].filter(Boolean).join(' ') ||
  '—';

/* ============================================================
   Empty state — not connected
   ============================================================ */
function EmptyState({ onConnect, connecting }) {
  return (
    <div className="mp-empty">
      <div className="left">
        <span className="eyebrow"><span className="dot"></span>Integración · Mercado Pago</span>
        <h2>Conecta Mercado Pago <span className="it">para empezar a cobrar</span></h2>
        <p>Autorizá a Tecnovend a procesar pagos en nombre de tu cuenta. Te llevamos a Mercado Pago, te autenticás una sola vez y volvés acá con tus locales y cajas sincronizados.</p>

        <div className="perks">
          <div className="perk">{Icon.check}<span><b>Pagos QR</b> usando tus credenciales reales, sin intermediarios.</span></div>
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
          Conexión OAuth 2.0 · solo lectura de cuenta + creación de pagos
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
            <div className="sub">se sincronizan solos</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Connected state — datos reales de MP + BD
   ============================================================ */
function ConnectedState({ status, onDisconnect }) {
  const [stores, setStores] = useState([]);
  const [pos, setPos] = useState([]);
  const [machines, setMachines] = useState([]);
  const [lastWebhook, setLastWebhook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p, m, w] = await Promise.all([
        apiFetch('/api/mp/stores').catch(() => []),
        apiFetch('/api/mp/pos').catch(() => []),
        apiFetch('/api/machines').catch(() => []),
        apiFetch('/api/debug/webhook-logs?limit=1').catch(() => []),
      ]);
      setStores(Array.isArray(s) ? s : []);
      setPos(Array.isArray(p) ? p : []);
      setMachines(Array.isArray(m) ? m : []);
      setLastWebhook(Array.isArray(w) && w.length ? w[0] : null);
      setLastSync(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Máquina vinculada a una caja: por mp_pos_id (id de MP) o pos_id (external_id)
  const machineForPos = (p) =>
    machines.find(m =>
      (m.mp_pos_id && String(m.mp_pos_id) === String(p.id)) ||
      (p.external_id && m.pos_id === p.external_id)
    ) || null;

  const posOfStore = (s) => pos.filter(p => String(p.store_id) === String(s.id));
  const linkedCount = pos.filter(p => machineForPos(p)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Account header */}
      <div className="mp-account">
        <div className="badge">MP</div>
        <div className="info">
          <div className="name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Cuenta Mercado Pago
            <span className="verified" title="Conexión verificada" style={{ display: "inline-flex", color: "var(--ok)" }}>{Icon.check}</span>
            <span className="spill ok" style={{ marginLeft: 6 }}>conectado</span>
          </div>
          <div className="meta">
            <span className="mono">user_id: {status?.user_id ?? '—'}</span>
            <span className="sep">·</span>
            <span>{status?.oauth ? 'vía OAuth' : 'vía access token (env)'}</span>
            {lastSync && (
              <>
                <span className="sep">·</span>
                <span>sincronizado {lastSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}>{Icon.refresh} {loading ? 'Sincronizando…' : 'Sincronizar'}</button>
          <button className="danger" onClick={onDisconnect}>{Icon.unplug} Desconectar</button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="detail-strip">
        <div className="item">
          <span className="label">Locales</span>
          <span className="value">{loading ? '…' : stores.length}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">stores en tu cuenta MP</span>
        </div>
        <div className="item">
          <span className="label">Cajas QR · POS</span>
          <span className="value">{loading ? '…' : pos.length}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">{linkedCount} vinculada{linkedCount !== 1 ? 's' : ''} a máquinas</span>
        </div>
        <div className="item">
          <span className="label">Máquinas</span>
          <span className="value">{loading ? '…' : machines.length}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">en la organización activa</span>
        </div>
        <div className="item">
          <span className="label">Último webhook</span>
          <span className="value" style={{ color: lastWebhook ? "var(--ok)" : "var(--ink-3)" }}>
            {loading ? '…' : lastWebhook ? timeAgo(lastWebhook.received_at) : '—'}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} className="mono">
            {lastWebhook?.result ? lastWebhook.result.slice(0, 38) : 'sin notificaciones aún'}
          </span>
        </div>
      </div>

      {/* Locales */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Locales</div>
            <div className="card-sub">Sucursales registradas en tu cuenta de Mercado Pago</div>
          </div>
        </div>
        <div className="locale-list">
          {loading ? (
            <div style={{ padding: '24px 18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando locales…</div>
          ) : stores.length === 0 ? (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
              Sin locales en esta cuenta MP. Se crean automáticamente al tagear una máquina.
            </div>
          ) : (
            <>
              <div className="locale head">
                <span></span>
                <span>Local</span>
                <span>Cajas QR</span>
                <span>Point</span>
                <span>Máquinas vinculadas</span>
                <span></span>
              </div>
              {stores.map(s => {
                const sp = posOfStore(s);
                const linked = sp.filter(p => machineForPos(p)).length;
                return (
                  <div className="locale" key={s.id}>
                    <div className="locale-ico">{Icon.building}</div>
                    <div className="locale-name">
                      <span className="n">{s.name}</span>
                      <span className="addr" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{Icon.pin} {storeAddress(s)}</span>
                    </div>
                    <div className="locale-stat">{Icon.qr}<span className="v">{sp.length}</span></div>
                    {/* Point oculto hasta tener los posnet (Fase 2) */}
                    <div className="locale-stat" style={{ color: 'var(--ink-4)' }}>{Icon.card}<span className="v">—</span></div>
                    <div className="locale-stat" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {Icon.machine}
                      <span className="v">{linked}</span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 4 }} className="mono">de {sp.length} posibles</span>
                    </div>
                    <span></span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Devices / POS */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">POS · Cajas QR</div>
            <div className="card-sub">Cada caja se vincula a una máquina desde su pantalla (card "Tageo MP")</div>
          </div>
          <div className="card-actions">
            <span className="pill">{pos.length} dispositivo{pos.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="dev-list">
          {loading ? (
            <div style={{ padding: '24px 18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando cajas…</div>
          ) : pos.length === 0 ? (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
              Sin cajas QR todavía. Se crean al tagear una máquina desde su pantalla.
            </div>
          ) : (
            <>
              <div className="dev-row head">
                <span></span>
                <span>Dispositivo</span>
                <span>Local</span>
                <span>Vinculado a</span>
                <span>Estado</span>
                <span></span>
              </div>
              {/* Vinculadas a máquinas (activas) primero */}
              {[...pos].sort((a, b) => (machineForPos(b) ? 1 : 0) - (machineForPos(a) ? 1 : 0)).map(p => {
                const m = machineForPos(p);
                const store = stores.find(s => String(s.id) === String(p.store_id));
                return (
                  <div className="dev-row" key={p.id}>
                    <div className="ico qr">{Icon.qr}</div>
                    <div className="name-cell">
                      <span className="n">{p.name || 'Caja QR'}</span>
                      <span className="mono">{p.external_id || p.id}</span>
                    </div>
                    <div style={{ color: "var(--ink-2)" }}>{store?.name || (p.store_id ? `Local ${p.store_id}` : '—')}</div>
                    <div>
                      {m ? (
                        <span className="machine-tag">{Icon.machine}{m.id}</span>
                      ) : (
                        <span className="machine-tag empty">sin vincular</span>
                      )}
                    </div>
                    <div>
                      {m ? (
                        <span className="spill ok">{Icon.check} activo</span>
                      ) : (
                        <span className="spill warn">pendiente</span>
                      )}
                    </div>
                    <span></span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   App entry
   ============================================================ */
export default function Pagos() {
  const { orgId } = useAuth();
  const [envProd, setEnvProd] = useState(true);
  const [status, setStatus] = useState(null); // null = cargando
  const [connecting, setConnecting] = useState(false);

  const checkStatus = async () => {
    try { setStatus(await apiFetch('/api/mp/status')); }
    catch { setStatus({ connected: false }); }
  };

  useEffect(() => { checkStatus(); }, []);

  // OAuth real: redirige al flujo de autorización de MP del cliente activo
  // (vuelve por el callback). El local y las cajas viven en su cuenta.
  const connect = () => {
    if (!orgId) { alert('Seleccioná un cliente antes de conectar Mercado Pago.'); return; }
    setConnecting(true);
    window.location.href = `${API_BASE}/api/mp/auth?org=${encodeURIComponent(orgId)}`;
  };

  const disconnect = async () => {
    if (!confirm("¿Desconectar la cuenta de Mercado Pago? Vas a tener que reautorizar para volver a cobrar.")) return;
    try {
      await apiFetch('/api/mp/auth/disconnect', { method: 'POST' });
      await checkStatus();
    } catch (e) {
      alert('No se pudo desconectar: ' + e.message);
    }
  };

  const connected = status?.connected === true;

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar
          envProd={envProd}
          onEnvToggle={() => setEnvProd(p => !p)}
          crumbs={["Operación", "Pagos · Mercado Pago"]}
        />
        <div className="page" data-screen-label={connected ? "02 Pagos · MP conectado" : "01 Pagos · MP conectar"}>
          <div className="page-head">
            <div>
              <h1 className="page-title">
                Pagos · Mercado Pago
                {connected && <span className="accent"> — cuenta vinculada</span>}
                {!connected && status !== null && <span className="accent"> — autorizá tu cuenta</span>}
              </h1>
              <div className="page-subtitle">
                {connected
                  ? "Tus locales y cajas QR sincronizan automáticamente."
                  : "Una sola autorización OAuth conecta toda tu operación."}
              </div>
            </div>
          </div>

          {status === null ? (
            <div style={{ padding: 40, color: 'var(--ink-3)' }}>Verificando conexión con Mercado Pago…</div>
          ) : connected ? (
            <ConnectedState status={status} onDisconnect={disconnect} />
          ) : (
            <EmptyState onConnect={connect} connecting={connecting} />
          )}
        </div>
      </div>
    </div>
  );
}

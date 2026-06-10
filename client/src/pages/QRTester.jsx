import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';

const API = (() => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && !['localhost','127.0.0.1'].includes(window.location.hostname))
    return window.location.origin.replace('tecnovend-web', 'tecnovend-api');
  return '';
})();
const ars = (n) => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });

/* ──────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ──────────────────────────────────────────────────────────
   MP Status badge
────────────────────────────────────────────────────────── */
function MPStatusBadge({ status }) {
  if (status === null) return <span className="pill">Verificando…</span>;
  if (status.connected) {
    return (
      <span className="pill live">
        <span className="d"></span>
        MP conectado · user_id {status.user_id}
      </span>
    );
  }
  return (
    <span className="spill warn" style={{ fontSize: 12 }}>
      {Icon.alert}&nbsp;MP desconectado — configurá MP_ACCESS_TOKEN en .env
    </span>
  );
}

/* ──────────────────────────────────────────────────────────
   Setup instructions panel
────────────────────────────────────────────────────────── */
function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
      <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <div className="card-title" style={{ color: '#b45309' }}>
            {Icon.alert}&nbsp; Cómo configurar el sandbox de Mercado Pago
          </div>
          <div className="card-sub">Seguí estos pasos para obtener tu Access Token de prueba</div>
        </div>
        <span style={{ color: '#b45309', fontSize: 12, fontWeight: 500 }}>{open ? 'Ocultar' : 'Ver pasos'}</span>
      </div>
      {open && (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 0 }}>
          {[
            ['1', 'Creá una cuenta en', 'developers.mercadopago.com', 'https://developers.mercadopago.com'],
            ['2', 'Andá a', 'Tus integraciones → Nueva aplicación', null],
            ['3', 'Completá el formulario → en "¿Cuál es el producto de MP que vas a integrar?" elegí "Pagos online"'],
            ['4', 'En la aplicación creada, andá a Credenciales → Credenciales de prueba'],
            ['5', 'Copiá el Access Token (empieza con TEST-)'],
            ['6', 'Pegalo en server/.env como MP_ACCESS_TOKEN=TEST-…'],
            ['7', 'Para recibir webhooks localmente: npx ngrok http 3000 → copiá la URL → .env como MP_WEBHOOK_URL'],
          ].map(([n, ...rest]) => (
            <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: '#b45309', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>{n}</span>
              <span style={{ fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
                {rest[0]}{' '}
                {rest[1] && (rest[2]
                  ? <a href={rest[2]} target="_blank" rel="noreferrer" style={{ color: '#b45309', fontWeight: 500 }}>{rest[1]}</a>
                  : <strong style={{ color: '#b45309' }}>{rest[1]}</strong>
                )}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 4, padding: '10px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontFamily: 'Geist Mono, monospace', fontSize: 12, color: '#9a3412' }}>
            # server/.env<br />
            MP_ACCESS_TOKEN=TEST-xxxx…<br />
            MP_WEBHOOK_URL=https://xxxx.ngrok-free.app/api/webhooks/mercadopago
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   New machine quick-register form
────────────────────────────────────────────────────────── */
function NewMachineForm({ onCreated }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const n = String(Math.floor(Math.random() * 900) + 100);
      const id = 'machine_' + n;
      await apiFetch('/api/machines', {
        method: 'POST',
        body: JSON.stringify({ id, name: name.trim(), location: location.trim() }),
      });
      onCreated();
      setName(''); setLocation('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', background: 'var(--bg)', borderTop: '1px solid var(--line-2)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
        Registrar máquina de prueba
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
        <input
          className="form-field input"
          style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', fontFamily: 'inherit', fontSize: 13, outline: 0 }}
          placeholder="Nombre *"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <input
          style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', fontFamily: 'inherit', fontSize: 13, outline: 0 }}
          placeholder="Sede (opcional)"
          value={location}
          onChange={e => setLocation(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!name.trim() || busy}>
          {busy ? '…' : Icon.plus}
        </button>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{err}</div>}
    </form>
  );
}

/* ──────────────────────────────────────────────────────────
   Machine selector (left panel)
────────────────────────────────────────────────────────── */
function MachineList({ machines, selectedId, onSelect, onRefresh }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Máquinas</div>
          <div className="card-sub">Registradas en el servidor</div>
        </div>
        <button className="link-btn" onClick={onRefresh}>{Icon.refresh}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {machines.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            Sin máquinas registradas en el servidor.<br />
            <span style={{ fontSize: 12 }}>Usá el formulario de abajo para crear una.</span>
          </div>
        ) : machines.map(m => {
          const hasPOS = !!m.mp_pos_id;
          const active = m.id === selectedId;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                padding: '12px 18px', background: active ? 'var(--tint)' : 'transparent',
                border: 0, borderTop: '1px solid var(--line-2)', cursor: 'pointer',
                textAlign: 'left', transition: 'background .1s',
              }}
            >
              <span className={'sdot ' + (m.status === 'active' ? 'ok' : m.status === 'maintenance' ? 'warn' : 'off')} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1 }}>{m.id}</div>
              </div>
              {hasPOS
                ? <span className="tag qr" style={{ fontSize: 10.5, flexShrink: 0 }}>QR activo</span>
                : <span className="tag empty" style={{ fontSize: 10.5, flexShrink: 0 }}>sin POS</span>
              }
            </button>
          );
        })}
      </div>

      <NewMachineForm onCreated={onRefresh} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   QR display image — soporta base64 o URL directa
────────────────────────────────────────────────────────── */
function QRImage({ base64, qrImageUrl, qrCode, waiting }) {
  const imgSrc = base64
    ? `data:image/png;base64,${base64}`
    : qrImageUrl || null;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{
        borderRadius: 16, overflow: 'hidden',
        border: `3px solid ${waiting ? 'var(--ok)' : 'var(--line)'}`,
        padding: 12, background: '#fff',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        transition: 'border-color .2s',
      }}>
        {imgSrc
          ? <img src={imgSrc} alt="QR Code" style={{ display: 'block', width: 220, height: 220 }} />
          : <div style={{ width: 220, height: 220, display: 'grid', placeItems: 'center', background: 'var(--bg)', borderRadius: 8 }}>
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>
                {Icon.qr}<br />Sin imagen QR
              </div>
            </div>
        }
      </div>
      {waiting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--ok)', animation: 'blink 1.2s ease-in-out infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ok)' }}>Escaneá el QR · esperando pago…</span>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Payment result panel
────────────────────────────────────────────────────────── */
function PaymentResult({ payment, onReset }) {
  const pulses = payment.pulses_calculated;
  return (
    <div style={{ textAlign: 'center', padding: '28px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--ok-soft)', color: 'var(--ok)', display: 'grid', placeItems: 'center', fontSize: 24 }}>
        {Icon.check}
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink-1)', letterSpacing: '-0.02em' }}>
          Pago aprobado
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
          {ars(payment.amount)} · {pulses} {pulses === 1 ? 'pulso' : 'pulsos'} encolados
        </div>
      </div>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 18px', width: '100%', textAlign: 'left' }}>
        {[
          ['machine_id', payment.machine_id],
          ['mp_payment_id', payment.mp_payment_id],
          ['amount', ars(payment.amount)],
          ['pulses_calculated', pulses],
          ['created_at', new Date(payment.created_at + 'Z').toLocaleTimeString('es-AR')],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line-2)', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-3)', fontFamily: 'Geist Mono, monospace' }}>{k}</span>
            <span style={{ color: 'var(--ink-1)', fontFamily: 'Geist Mono, monospace', fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
      {payment._via_mp && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 12px', width: '100%', textAlign: 'center' }}>
          Detectado vía MP directo — el webhook fue a producción (Railway)
        </div>
      )}
      <button className="btn primary" onClick={onReset} style={{ marginTop: 4 }}>
        {Icon.refresh} Nueva prueba
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Right panel — QR + controls
────────────────────────────────────────────────────────── */
function QRPanel({ machineId, machines, mpConnected }) {
  const machine = machines.find(m => m.id === machineId);
  const [pos, setPos] = useState(null);
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState('');
  const [settingUp, setSettingUp] = useState(false);
  const [amount, setAmount] = useState(15);
  const [description, setDescription] = useState('');
  const [orderActive, setOrderActive] = useState(false);
  const [orderRef, setOrderRef] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [orderStartTime, setOrderStartTime] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | waiting | paid | error
  const [lastPayment, setLastPayment] = useState(null);
  const [actionErr, setActionErr] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const pollRef = useRef(null);

  const fetchPOS = useCallback(async (id) => {
    if (!id) return;
    setPosLoading(true);
    setPosError('');
    try {
      const data = await apiFetch(`/api/mp/pos/${id}`);
      setPos(data);
    } catch (e) {
      if (e.message.includes('Sin POS')) setPos(null);
      else setPosError(e.message);
    } finally {
      setPosLoading(false);
    }
  }, []);

  useEffect(() => {
    setPos(null); setPhase('idle'); setOrderActive(false); setActionErr('');
    if (machineId) fetchPOS(machineId);
  }, [machineId, fetchPOS]);

  // Poll for payment — BD local + MP directo (por si el webhook va a otro servidor)
  useEffect(() => {
    if (phase !== 'waiting') { clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      try {
        // 1. Intentar BD local (requiere webhook local)
        const payments = await apiFetch(`/api/mp/payments?machineId=${machineId}&since=${encodeURIComponent(orderStartTime)}&limit=1`);
        if (payments.length > 0) {
          clearInterval(pollRef.current);
          setLastPayment(payments[0]);
          setPhase('paid');
          setOrderActive(false);
          return;
        }
        // 2. Polling directo a MP si tenemos order_id
        if (orderId) {
          const order = await apiFetch(`/api/mp/orders/${orderId}`);
          if (order.status === 'processed' || order.status === 'closed') {
            clearInterval(pollRef.current);
            setLastPayment({ machine_id: machineId, mp_payment_id: orderId, amount, pulses_calculated: Math.floor(amount / 250), created_at: new Date().toISOString(), _via_mp: true });
            setPhase('paid');
            setOrderActive(false);
            return;
          }
        }
        // Timeout after 15 minutos (expiración de la orden en MP)
        if (Date.now() - new Date(orderStartTime).getTime() > 15 * 60 * 1000) {
          clearInterval(pollRef.current);
          setPhase('idle');
          setOrderActive(false);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [phase, machineId, orderStartTime, orderId, amount]);

  const setupPOS = async () => {
    setSettingUp(true); setActionErr('');
    try {
      await apiFetch(`/api/mp/pos/${machineId}`, { method: 'POST' });
      await fetchPOS(machineId);
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setSettingUp(false);
    }
  };

  const loadOrder = async () => {
    if (!amount || amount < 1) return;
    setActionBusy(true); setActionErr('');
    try {
      const r = await apiFetch(`/api/mp/pos/${machineId}/order`, {
        method: 'PUT',
        body: JSON.stringify({ amount, description: description || machine?.name }),
      });
      setOrderRef(r.external_reference);
      setOrderId(r.order_id || null);
      setOrderStartTime(new Date().toISOString());
      setOrderActive(true);
      setPhase('waiting');
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const clearOrder = async () => {
    setActionBusy(true); setActionErr('');
    try {
      await apiFetch(`/api/mp/pos/${machineId}/order`, { method: 'DELETE' });
      setOrderActive(false);
      setPhase('idle');
      clearInterval(pollRef.current);
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const resetTester = () => {
    setPhase('idle'); setLastPayment(null); setOrderActive(false); setOrderRef(''); setOrderId(null);
  };

  if (!machine) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-4)' }}>
          <div style={{ marginBottom: 10, opacity: 0.4 }}>{Icon.qr}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-3)' }}>Seleccioná una máquina</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>para ver su QR y probar pagos</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Machine header */}
      <div className="card">
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="card-title">{machine.name}</div>
              <span className={'spill ' + (machine.status === 'active' ? 'ok' : 'warn')}>
                {machine.status === 'active' ? 'activa' : machine.status}
              </span>
            </div>
            <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--ink-4)', marginTop: 2, marginBottom: 8 }}>
              {machine.id}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {machine.location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                  {Icon.pin} {machine.location}
                </span>
              )}
              {(machine.mp_store_name || machine.mp_store_id) ? (
                <span className="tag store" style={{ fontSize: 11.5 }}>
                  {Icon.building} {machine.mp_store_name || `Local ${machine.mp_store_id}`}
                </span>
              ) : (
                <span className="tag empty" style={{ fontSize: 11.5 }}>sin local MP</span>
              )}
              {machine.pos_id ? (
                <span className="tag qr" style={{ fontSize: 11.5 }}>{Icon.qr} {machine.pos_id}</span>
              ) : (
                <span className="tag empty" style={{ fontSize: 11.5 }}>sin QR</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* POS setup */}
      {!machine.mp_pos_id && (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--mp-soft)', color: '#0288b0', display: 'grid', placeItems: 'center', fontSize: 22 }}>
              {Icon.qr}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-1)' }}>Esta máquina no tiene POS en MP</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
                Creá un store y POS en Mercado Pago para generar el QR estático de esta máquina.
              </div>
            </div>
            {!mpConnected ? (
              <div style={{ fontSize: 12, color: 'var(--warn)', background: 'var(--warn-soft)', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px' }}>
                Configurá tu MP_ACCESS_TOKEN antes de continuar
              </div>
            ) : (
              <button className="btn primary" onClick={setupPOS} disabled={settingUp} style={{ fontSize: 14, padding: '9px 18px' }}>
                {settingUp ? 'Creando store y POS…' : <>{Icon.plus} Crear store + POS en MP</>}
              </button>
            )}
            {actionErr && <div style={{ fontSize: 12, color: 'var(--bad)', background: 'var(--bad-soft)', padding: '6px 12px', borderRadius: 6 }}>{actionErr}</div>}
          </div>
        </div>
      )}

      {/* QR + controls */}
      {machine.mp_pos_id && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Código QR</div>
              <div className="card-sub">
                {posLoading ? 'Cargando…'
                  : pos ? `${pos.name || pos.external_id} · ID ${pos.id}`
                  : 'POS configurado'}
              </div>
            </div>
            <div className="card-actions">
              {pos && <span className="spill ok">{Icon.check} listo para escanear</span>}
              <button className="link-btn" onClick={() => fetchPOS(machineId)}>{Icon.refresh}</button>
            </div>
          </div>

          {posLoading && (
            <div style={{ padding: '28px', textAlign: 'center', color: 'var(--ink-4)' }}>
              <div style={{ width: 24, height: 24, border: '2px solid var(--ink-4)', borderTopColor: 'transparent', borderRadius: 999, animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            </div>
          )}

          {posError && (
            <div className="card-body">
              <div style={{ color: 'var(--bad)', fontSize: 13 }}>{posError}</div>
            </div>
          )}

          {phase === 'paid' && lastPayment && (
            <div className="card-body">
              <PaymentResult payment={lastPayment} onReset={resetTester} />
            </div>
          )}

          {phase !== 'paid' && pos && (
            <div className="card-body" style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
              {/* QR image — MP devuelve pos.qr.image como URL */}
              <QRImage
                base64={pos.qr_code_base64}
                qrImageUrl={pos.qr?.image}
                qrCode={pos.qr_code || pos.qr?.image}
                waiting={phase === 'waiting'}
              />

              {/* Controls */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {phase === 'idle' && (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                      El QR ya está listo para escanear con la app de Mercado Pago.
                      Si querés pre-cargar un monto específico en el QR, completá los campos y hacé click en <strong>Cargar orden</strong>.
                    </div>

                    <div className="form-field">
                      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Monto (ARS) <span style={{ color: 'var(--brand)' }}>*</span></label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--ink-4)', fontSize: 14, fontWeight: 500 }}>$</span>
                        <input
                          type="number"
                          min="15"
                          value={amount}
                          onChange={e => setAmount(+e.target.value)}
                          style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontFamily: 'Geist Mono, monospace', fontSize: 14, outline: 0, width: '100%', color: 'var(--ink-1)' }}
                        />
                      </div>
                    </div>

                    <div className="form-field">
                      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Descripción</label>
                      <input
                        type="text"
                        placeholder={machine.name}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, outline: 0, color: 'var(--ink-1)' }}
                      />
                    </div>

                    {actionErr && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{actionErr}</div>}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn primary" onClick={loadOrder} disabled={actionBusy || amount < 15} style={{ flex: 1 }}>
                        {actionBusy ? 'Cargando…' : <>{Icon.qr} Cargar orden al QR</>}
                      </button>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                      Sin orden cargada, el cliente puede ingresar el monto manualmente en la app de MP.
                    </div>
                  </>
                )}

                {phase === 'waiting' && (
                  <>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span className="pill live"><span className="d"></span>Esperando pago</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'Geist Mono, monospace' }}>{ars(amount)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                        Escaneá el QR con la app de MP desde la cuenta compradora de tu sandbox y aprobá el pago.
                        El sistema polling cada 3 segundos.
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Orden activa</div>
                      <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--ink-2)' }}>
                        ref: {orderRef}<br />
                        monto: {ars(amount)}<br />
                        desc: {description || machine.name}
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: '#92400e', background: 'var(--warn-soft)', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                      💡 Si no tenés webhook configurado (ngrok), el pago se detecta cuando aparece en la BD local vía webhook. Sin webhook, usá el botón manual abajo.
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={clearOrder} disabled={actionBusy} style={{ flex: 1 }}>
                        {Icon.x} Cancelar orden
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent payments from this machine */}
      <RecentPayments machineId={machineId} phase={phase} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Recent payments feed
────────────────────────────────────────────────────────── */
function RecentPayments({ machineId, phase }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await apiFetch(`/api/mp/payments?machineId=${machineId}&limit=20`);
        if (!cancelled) { setPayments(data); setLastRefresh(new Date()); }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    };
    setLoading(true);
    load();
    const t = setInterval(load, phase === 'waiting' ? 3000 : 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [machineId, phase]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Historial de pagos</div>
          <div className="card-sub">
            {machineId} · {loading ? 'cargando…' : `${payments.length} registro${payments.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {phase === 'waiting' && <span className="pill live"><span className="d"></span>live</span>}
          {lastRefresh && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {!loading && payments.length === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
          Sin pagos registrados para esta máquina aún.
        </div>
      ) : (
        <>
          <div className="tx head">
            <span></span>
            <span>ID de pago</span>
            <span>Hora</span>
            <span style={{ textAlign: 'right' }}>Pulsos</span>
            <span style={{ textAlign: 'right' }}>Monto</span>
            <span></span>
          </div>
          {payments.map((p, i) => (
            <div className="tx" key={i} style={{ background: i === 0 && phase === 'waiting' ? 'var(--tint)' : '' }}>
              <div className="tx-method qr">{Icon.qr}</div>
              <div>
                <div className="tx-prod">
                  <span className="mono" style={{ fontSize: 12 }}>mp_{p.mp_payment_id?.slice(-10)}</span>
                  <span className={'tx-status ' + p.status}>
                    {p.status === 'approved'
                      ? p.pulses_calculated === 0
                        ? <>⚠ aprobado · sin pulsos</>
                        : <>{Icon.check} aprobado</>
                      : p.status}
                  </span>
                </div>
                <div className="tx-meta mono" style={{ fontSize: 11 }}>
                  {p.mp_payment_id}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {new Date(p.created_at + 'Z').toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: 'var(--ink-1)' }}>
                {p.pulses_calculated}p
              </div>
              <div>
                <div className="tx-amount mono">{ars(p.amount)}</div>
              </div>
              <div className="chev">{Icon.chev}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Main page
────────────────────────────────────────────────────────── */
export default function QRTester() {
  const [mpStatus, setMpStatus] = useState(null);
  const [machines, setMachines] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [envProd] = useState(false);

  const loadMachines = useCallback(async () => {
    try {
      const data = await apiFetch('/api/machines');
      setMachines(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    apiFetch('/api/mp/status')
      .then(s => setMpStatus(s))
      .catch(() => setMpStatus({ connected: false, error: 'Servidor no disponible' }));
    loadMachines();
  }, [loadMachines]);

  const mpConnected = mpStatus?.connected === true;

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => {}} crumbs={['Desarrollo', 'QR · Tester']} />
        <div className="page" data-screen-label="QR Tester">
          <div className="page-head">
            <div>
              <h1 className="page-title">
                QR · Tester <span className="accent">— sandbox Mercado Pago</span>
              </h1>
              <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <MPStatusBadge status={mpStatus} />
                <span style={{ color: 'var(--ink-4)' }}>·</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>QR estático · modelo MP</span>
              </div>
            </div>
          </div>

          {(!mpStatus || !mpConnected) && <SetupGuide />}

          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, alignItems: 'start' }}>
            <MachineList
              machines={machines}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRefresh={loadMachines}
            />
            <QRPanel
              machineId={selectedId}
              machines={machines}
              mpConnected={mpConnected}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

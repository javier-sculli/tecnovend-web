import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';

export default function PortalEmpleado() {
  const { machineId } = useParams();
  const [searchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const rawCollectionStatus = searchParams.get('collection_status');
  const isMpSuccessInitial = rawStatus === 'success' || rawStatus === 'approved' || rawCollectionStatus === 'approved';
  const isMpFailureInitial = rawStatus === 'failure' || rawStatus === 'rejected' || rawCollectionStatus === 'rejected';
  const initialIntent = searchParams.get('intent') || searchParams.get('external_reference');

  const [returnStatus, setReturnStatus] = useState(isMpSuccessInitial ? 'success' : isMpFailureInitial ? 'failure' : null);
  const [returnIntent, setReturnIntent] = useState(initialIntent);

  // Estados de datos
  const [machine, setMachine] = useState(null);
  const [loadingMachine, setLoadingMachine] = useState(true);
  const [employee, setEmployee] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Estados de flujo de Login OTP
  const [emailInput, setEmailInput] = useState('');
  const [otpStep, setOtpStep] = useState(false); // false = pedir email, true = pedir OTP
  const [otpCode, setOtpCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Estados de pago
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  // Polling y confirmación de pago post-MP
  const [intentStatus, setIntentStatus] = useState(isMpSuccessInitial ? 'confirming' : null);
  const [recentPayment, setRecentPayment] = useState(null);
  const [dismissRecent, setDismissRecent] = useState(false);

  // Detectar si está en un navegador embebido (WhatsApp, Instagram, etc.)
  const isInAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line|Telegram/i.test(navigator.userAgent);

  // 1. Cargar datos de la máquina
  useEffect(() => {
    async function loadMachine() {
      try {
        const res = await fetch(`/api/emp/machine/${machineId}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Máquina no encontrada');
        }
        const data = await res.json();
        setMachine(data);
        if (data.qrMode === 'fixed' && data.fixedAmount) {
          setCustomAmount(String(data.fixedAmount));
        }
      } catch (e) {
        setAuthError(e.message);
      } finally {
        setLoadingMachine(false);
      }
    }
    if (machineId) loadMachine();
  }, [machineId]);

  // 2. Verificar si ya hay una sesión guardada (Cookie o LocalStorage)
  useEffect(() => {
    async function checkSession() {
      try {
        const localToken = localStorage.getItem('tv_emp_token');
        const headers = {};
        if (localToken) headers['Authorization'] = `Bearer ${localToken}`;

        const res = await fetch(`/api/emp/auth/me?machineId=${machineId}`, {
          headers,
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          setEmployee(data.employee);
          if (data.lastRecentPaidIntent && !isMpSuccessInitial) {
            setRecentPayment(data.lastRecentPaidIntent);
            setIntentStatus('paid');
          }
        }
      } catch (_) {
        // No logueado o sesión vencida
      } finally {
        setCheckingAuth(false);
      }
    }
    if (machineId) checkSession();
  }, [machineId]);

  // 3. Polling de status si retornó exitoso de Mercado Pago
  useEffect(() => {
    if (returnStatus !== 'success' || !returnIntent) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/emp/checkout/intent-status/${returnIntent}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'paid') {
            setIntentStatus('paid');
            setRecentPayment({
              id: returnIntent,
              listAmount: data.listAmount,
              chargeAmount: data.chargeAmount,
              discountPct: data.discountPct,
              discountAmount: data.discountAmount,
              paidAt: data.paidAt,
            });
            clearInterval(interval);
          }
        }
      } catch (_) {}

      if (attempts > 12) {
        // Si pasaron 24s y no confirmó, dejamos que el usuario vea igual que fue aprobado por MP
        setIntentStatus('paid');
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [returnStatus, returnIntent]);

  // Handler: Pedir OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    setSendingOtp(true);
    setAuthError('');

    try {
      const res = await fetch('/api/emp/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, email: emailInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el código');

      setOtpStep(true);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setSendingOtp(false);
    }
  };

  // Handler: Verificar OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.length !== 4) {
      setAuthError('Ingresá el código de 4 dígitos');
      return;
    }
    setVerifyingOtp(true);
    setAuthError('');

    try {
      const res = await fetch('/api/emp/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, email: emailInput.trim(), code: otpCode.trim() }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código incorrecto');

      // Guardar token en localStorage para navegación persistente
      if (data.token) {
        localStorage.setItem('tv_emp_token', data.token);
      }
      setEmployee(data.employee);
      setOtpStep(false);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setVerifyingOtp(false);
    }
  };

  // Handler: Logout
  const handleLogout = async () => {
    try {
      const localToken = localStorage.getItem('tv_emp_token');
      localStorage.removeItem('tv_emp_token');
      await fetch('/api/emp/auth/logout', {
        method: 'POST',
        headers: localToken ? { Authorization: `Bearer ${localToken}` } : {},
        credentials: 'include',
      });
    } catch (_) {}
    setEmployee(null);
    setOtpStep(false);
    setOtpCode('');
  };

  // Handler: Pagar con Mercado Pago
  const handlePay = async () => {
    setPayError('');
    setPaying(true);

    try {
      const localToken = localStorage.getItem('tv_emp_token');
      const headers = { 'Content-Type': 'application/json' };
      if (localToken) headers['Authorization'] = `Bearer ${localToken}`;

      let amountToSend = machine?.qrMode === 'fixed' ? machine.fixedAmount : Number(customAmount);
      if (!amountToSend || amountToSend <= 0) {
        throw new Error('Por favor ingresá un monto válido');
      }

      const res = await fetch('/api/emp/checkout/create-order', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ machineId, listAmount: amountToSend }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar el cobro');

      // Redirigir a Mercado Pago
      if (data.initPoint) {
        window.location.href = data.initPoint;
      } else {
        throw new Error('No se recibió la URL de pago de Mercado Pago');
      }
    } catch (err) {
      setPayError(err.message);
      setPaying(false);
    }
  };

  // Handler: Hacer otro pago tras una compra exitosa
  const handleMakeAnotherPayment = () => {
    setDismissRecent(true);
    setRecentPayment(null);
    setReturnStatus(null);
    setReturnIntent(null);
    setIntentStatus(null);
    window.history.replaceState({}, '', `/e/${machineId}`);
  };

  // Cálculo del monto bonificado
  const discountPct = Number(employee?.discountPct) || Number(machine?.defaultDiscountPct) || 20;
  const rawListAmount = machine?.qrMode === 'fixed' ? machine.fixedAmount : Number(customAmount || 0);
  const calculatedDiscount = Math.round(rawListAmount * (discountPct / 100));
  const finalAmountToPay = Math.max(15, rawListAmount - calculatedDiscount);

  if (loadingMachine || checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', background: '#09090b', color: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #27272a', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 14, color: '#a1a1aa' }}>Cargando máquina…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#09090b', color: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '16px 12px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      {/* Tip de navegador embebido */}
      {isInAppBrowser && (
        <div style={{ width: '100%', maxWidth: 440, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.4 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <div>
            <b>Tip para no loguearte de nuevo:</b> Abrí este link en <b>Safari o Chrome</b> (tocá los tres puntos o compartir) y tu sesión se guardará para siempre.
          </div>
        </div>
      )}

      {/* Tarjeta principal */}
      <div style={{ width: '100%', maxWidth: 440, background: '#18181b', border: '1px solid #27272a', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)' }}>
        
        {/* Cabecera estilo Cartel QR */}
        <div style={{ position: 'relative', padding: '24px 20px 18px', borderBottom: '1px solid #27272a', background: 'linear-gradient(180deg, #27272a 0%, #18181b 100%)', textAlign: 'center' }}>
          {employee && (
            <button
              onClick={handleLogout}
              style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid #3f3f46', borderRadius: 6, color: '#a1a1aa', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
            >
              Cerrar sesión
            </button>
          )}

          {/* Logo VendPoint */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'radial-gradient(120% 120% at 0% 0%, #ed7a3a 0%, #c2410c 55%, #7c2d12 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 5px rgba(0,0,0,0.25)',
              flexShrink: 0
            }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="3" width="14" height="18" rx="2" />
                <line x1="9" y1="7" x2="15" y2="7" />
                <line x1="9" y1="11" x2="15" y2="11" />
                <rect x="13" y="14" width="4" height="4" rx="0.5" />
              </svg>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: '#ffffff', lineHeight: 1 }}>VendPoint</div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: '#a1a1aa', textTransform: 'uppercase', marginTop: 3 }}>PAGOS INTELIGENTES</div>
            </div>
          </div>

          {/* Badge Beneficio Empleados */}
          <div style={{ marginBottom: 10 }}>
            <span style={{
              background: '#10b981',
              color: '#ffffff',
              padding: '3px 12px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              display: 'inline-block'
            }}>
              BENEFICIO EMPLEADOS
            </span>
          </div>

          {/* Nombre del Cliente */}
          {machine?.clientName && (
            <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>
              {machine.clientName}
            </div>
          )}

          {/* Nombre de la Máquina */}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#ffffff', letterSpacing: -0.3 }}>
            {machine?.name || 'Máquina Expendedora'}
          </h1>

          {/* Ubicación y estado */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, fontSize: 12.5, color: '#a1a1aa' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: machine?.status === 'active' ? '#10b981' : '#ef4444', display: 'inline-block' }} />
            {machine?.location ? <span>{machine.location}</span> : <span>{machine?.status === 'active' ? 'Operativa' : 'Mantenimiento'}</span>}
          </div>
        </div>

        {/* Pantalla de confirmación de pago post-MP o compra reciente */}
        {(!dismissRecent && (returnStatus === 'success' || (recentPayment && intentStatus === 'paid'))) ? (
          <div style={{ padding: '28px 20px 24px', textAlign: 'center' }}>
            {intentStatus === 'confirming' && !recentPayment ? (
              <>
                <div style={{ width: 48, height: 48, border: '4px solid #27272a', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', color: '#ffffff' }}>
                  Verificando acreditación con Mercado Pago…
                </h2>
                <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 20px', lineHeight: 1.4 }}>
                  Estamos comunicándonos con la máquina para entregar tu producto…
                </p>
              </>
            ) : (
              <>
                <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '2px solid #10b981', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 28, fontWeight: 900 }}>
                  ✓
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#ffffff', letterSpacing: -0.3 }}>
                  ¡Pago Acreditado!
                </h2>

                {/* Instrucción de cara a la máquina */}
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 12, padding: '14px 16px', margin: '14px 0 16px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>⚡</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      Crédito entregado a la máquina
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, color: '#f4f4f5', lineHeight: 1.45 }}>
                    Elegí tu producto en la <b>botonera de la máquina</b> o retiralo de la <b>bandeja de entrega</b>.
                  </p>
                </div>

                {/* Detalle del pago */}
                {recentPayment && (
                  <div style={{ background: '#27272a', borderRadius: 10, padding: '12px 14px', marginBottom: 20, textAlign: 'left', fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#a1a1aa' }}>
                      <span>Monto abonado con beneficio:</span>
                      <span style={{ color: '#ffffff', fontWeight: 700 }}>${recentPayment.chargeAmount?.toLocaleString()}</span>
                    </div>
                    {recentPayment.discountAmount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', fontSize: 12.5 }}>
                        <span>Ahorro aplicado ({recentPayment.discountPct}% OFF):</span>
                        <span>-${recentPayment.discountAmount?.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleMakeAnotherPayment}
                  style={{
                    width: '100%',
                    padding: '13px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    borderRadius: 8,
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <span>+ Hacer otro pago</span>
                </button>
              </>
            )}
          </div>
        ) : returnStatus === 'failure' ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 32 }}>
              ✕
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#ffffff' }}>
              Pago no completado
            </h2>
            <p style={{ fontSize: 14, color: '#a1a1aa', margin: '0 0 20px' }}>
              No se realizó ningún cobro en tu cuenta. Podés reintentar cuando quieras.
            </p>
            <a href={`/e/${machineId}`} style={{ display: 'inline-block', padding: '12px 24px', background: '#3b82f6', color: '#ffffff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
              Reintentar
            </a>
          </div>
        ) : !machine?.employeeDiscountEnabled ? (
          /* Máquina sin beneficio */
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>ℹ️</div>
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>Beneficio no disponible</h3>
            <p style={{ fontSize: 13.5, color: '#a1a1aa', lineHeight: 1.5 }}>
              El descuento de empleados no se encuentra activado para esta máquina en particular. Podés abonar al precio regular escaneando el código QR grande de Mercado Pago.
            </p>
          </div>
        ) : machine?.status !== 'active' ? (
          /* Máquina fuera de servicio */
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px', color: '#f87171' }}>Máquina Fuera de Servicio</h3>
            <p style={{ fontSize: 13.5, color: '#a1a1aa', lineHeight: 1.5 }}>
              La máquina se encuentra en mantenimiento o desconectada. Para proteger tu dinero, los cobros están temporalmente deshabilitados.
            </p>
          </div>
        ) : !employee ? (
          /* ── Flujo de Autenticación OTP ── */
          <div style={{ padding: 20 }}>
            {authError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
                {authError}
              </div>
            )}

            {!otpStep ? (
              <form onSubmit={handleRequestOtp}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#d4d4d8', marginBottom: 6 }}>
                    Tu email corporativo o laboral
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="ej: juan.perez@empresa.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8, background: '#27272a', border: '1px solid #3f3f46', color: '#ffffff', fontSize: 15, outline: 'none' }}
                  />
                  <span style={{ display: 'block', fontSize: 11.5, color: '#71717a', marginTop: 6 }}>
                    Te mandaremos un código de 4 dígitos para ingresar una sola vez.
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={sendingOtp || !emailInput.trim()}
                  style={{ width: '100%', padding: '13px', borderRadius: 8, background: '#3b82f6', color: '#ffffff', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: sendingOtp ? 0.7 : 1 }}
                >
                  {sendingOtp ? 'Verificando nómina…' : 'Continuar →'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#d4d4d8', marginBottom: 4 }}>
                    Código de 4 dígitos
                  </label>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: '#a1a1aa' }}>
                    Enviado a <b>{emailInput}</b>
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    autoFocus
                    placeholder="0000"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '14px', borderRadius: 8, background: '#27272a', border: '1px solid #3b82f6', color: '#ffffff', fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: 800, outline: 'none' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={verifyingOtp || otpCode.length !== 4}
                  style={{ width: '100%', padding: '13px', borderRadius: 8, background: '#10b981', color: '#ffffff', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: verifyingOtp ? 0.7 : 1, marginBottom: 12 }}
                >
                  {verifyingOtp ? 'Validando…' : 'Ingresar y Guardar Sesión'}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <button type="button" onClick={() => setOtpStep(false)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0 }}>
                    ← Cambiar email
                  </button>
                  <button type="button" onClick={handleRequestOtp} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', padding: 0 }}>
                    Reenviar código
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* ── Pantalla de Cobro con Descuento (Logueado) ── */
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#27272a', padding: '12px 14px', borderRadius: 10, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Empleado</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ffffff' }}>{employee.name}</div>
                <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: 11, cursor: 'pointer', padding: 0, marginTop: 2, textDecoration: 'underline' }}>
                  Cerrar sesión
                </button>
              </div>
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#10b981', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 800 }}>
                {discountPct}% OFF
              </div>
            </div>

            {payError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
                {payError}
              </div>
            )}

            {/* Monto dinámico si no es de precio fijo */}
            {machine?.qrMode !== 'fixed' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#d4d4d8', marginBottom: 6 }}>
                  Importe que figura en la máquina:
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: 12, fontSize: 18, color: '#a1a1aa', fontWeight: 600 }}>$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Ej: 1200"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 30px', borderRadius: 8, background: '#27272a', border: '1px solid #3f3f46', color: '#ffffff', fontSize: 18, fontWeight: 700, outline: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* Desglose de precios */}
            <div style={{ background: '#27272a', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13.5, color: '#a1a1aa' }}>
                <span>Precio regular:</span>
                <span>${rawListAmount > 0 ? rawListAmount.toLocaleString() : '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13.5, color: '#10b981' }}>
                <span>Descuento aplicado ({discountPct}%):</span>
                <span>-${calculatedDiscount > 0 ? calculatedDiscount.toLocaleString() : '0'}</span>
              </div>
              <div style={{ borderTop: '1px solid #3f3f46', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Tu total a pagar:</span>
                <span style={{ fontSize: 26, fontWeight: 800, color: '#10b981' }}>
                  ${rawListAmount > 0 ? finalAmountToPay.toLocaleString() : '0'}
                </span>
              </div>
            </div>

            {/* Botón de pago con Mercado Pago */}
            <button
              onClick={handlePay}
              disabled={paying || rawListAmount <= 0}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: 10,
                background: '#009ee3',
                color: '#ffffff',
                border: 'none',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: paying || rawListAmount <= 0 ? 0.6 : 1,
                boxShadow: '0 4px 14px rgba(0, 158, 227, 0.4)',
              }}
            >
              {paying ? (
                <span>Abriendo Mercado Pago…</span>
              ) : (
                <>
                  <span>Pagar ${finalAmountToPay.toLocaleString()} con</span>
                  <span style={{ background: '#ffffff', color: '#009ee3', padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: 800 }}>
                    Mercado Pago
                  </span>
                </>
              )}
            </button>
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11.5, color: '#71717a' }}>
              🔒 Pago seguro procesado directamente por Mercado Pago
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: '#52525b' }}>
        VendPoint OS · Sistema de pagos inteligentes
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

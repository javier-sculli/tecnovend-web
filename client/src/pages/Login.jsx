import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icons.jsx';
import { apiFetch } from '../api.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email.trim(), password);
      const to = location.state?.from?.pathname || '/';
      navigate(to, { replace: true });
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(''); setBusy(true);
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setForgotSent(true);
    } catch (err) {
      setError(err.message || 'No se pudo procesar la solicitud');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      {mode === 'login' ? (
        <form className="card" onSubmit={handleLogin} style={{ width: 380, maxWidth: '90vw', padding: 4 }}>
          <div className="card-head" style={{ borderBottom: 'none' }}>
            <div>
              <div className="card-title" style={{ fontSize: 18 }}>VendPoint</div>
              <div className="card-sub">Iniciá sesión para gestionar tus máquinas</div>
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vos@empresa.com"
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="form-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Contraseña</label>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(''); setForgotSent(false); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--brand)',
                    cursor: 'pointer',
                    fontSize: 12,
                    textDecoration: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="spill bad" style={{ alignSelf: 'flex-start' }}>{Icon.alert} {error}</div>
            )}
            <button className="btn primary" type="submit" disabled={busy || !email || !password} style={{ justifyContent: 'center' }}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </div>
        </form>
      ) : (
        <form className="card" onSubmit={handleForgotPassword} style={{ width: 380, maxWidth: '90vw', padding: 4 }}>
          <div className="card-head" style={{ borderBottom: 'none' }}>
            <div>
              <div className="card-title" style={{ fontSize: 18 }}>VendPoint</div>
              <div className="card-sub">Recuperar contraseña</div>
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {forgotSent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  background: 'var(--ok-soft)',
                  border: '1px solid #bbf7d0',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px 14px',
                  fontSize: 13,
                  color: 'var(--ok)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {Icon.check} Solicitud enviada
                  </div>
                  <div style={{ color: 'var(--ink-2)', lineHeight: 1.45, fontSize: 12.5 }}>
                    Si <strong>{email.trim()}</strong> está registrado en el sistema, recibirás un correo con el enlace para restablecer tu contraseña. Revisá tu casilla y carpeta de correo no deseado (spam).
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setMode('login'); setForgotSent(false); setError(''); }}
                  style={{ justifyContent: 'center' }}
                >
                  Volver al inicio de sesión
                </button>
              </div>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                  Ingresá tu correo electrónico y te enviaremos las instrucciones para restablecer tu contraseña.
                </p>
                <div className="form-field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="vos@empresa.com"
                    autoFocus
                    autoComplete="username"
                  />
                </div>
                {error && (
                  <div className="spill bad" style={{ alignSelf: 'flex-start' }}>{Icon.alert} {error}</div>
                )}
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || !email.trim()}
                  style={{ justifyContent: 'center' }}
                >
                  {busy ? 'Enviando…' : 'Enviar enlace de recuperación'}
                </button>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(''); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--ink-3)',
                      cursor: 'pointer',
                      fontSize: 12.5,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--ink-1)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-3)'}
                  >
                    ← Volver a Iniciar Sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

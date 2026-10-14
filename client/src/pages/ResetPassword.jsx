import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { Icon } from '../components/Icons.jsx';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('checking'); // 'checking' | 'valid' | 'invalid' | 'success'
  const [userEmail, setUserEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setError('No se incluyó el token de recuperación en el enlace.');
      return;
    }

    let active = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
        if (!active) return;
        if (res.valid) {
          setUserEmail(res.email || '');
          setStatus('valid');
        } else {
          setStatus('invalid');
          setError(res.error || 'El enlace es inválido o ha expirado.');
        }
      } catch (err) {
        if (!active) return;
        setStatus('invalid');
        setError(err.message || 'No se pudo verificar el enlace.');
      }
    })();

    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setStatus('success');
    } catch (err) {
      setError(err.message || 'No se pudo restablecer la contraseña');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 380, maxWidth: '90vw', padding: 4 }}>
        <div className="card-head" style={{ borderBottom: 'none' }}>
          <div>
            <div className="card-title" style={{ fontSize: 18 }}>VendPoint</div>
            <div className="card-sub">Restablecer contraseña</div>
          </div>
        </div>

        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {status === 'checking' && (
            <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              Verificando enlace de recuperación…
            </div>
          )}

          {status === 'invalid' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="spill bad" style={{ alignSelf: 'stretch', padding: '10px 12px', fontSize: 13 }}>
                <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>{Icon.alert}</span>
                {error || 'El enlace de recuperación es inválido, ya fue utilizado o ha expirado.'}
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => navigate('/login', { replace: true })}
                style={{ justifyContent: 'center' }}
              >
                Volver al inicio de sesión
              </button>
            </div>
          )}

          {status === 'success' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{
                background: 'var(--ok-soft)',
                border: '1px solid #bbf7d0',
                borderRadius: 'var(--radius-sm)',
                padding: '14px',
                fontSize: 13,
                color: 'var(--ok)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  {Icon.check} ¡Contraseña actualizada!
                </div>
                <div style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
                  Tu contraseña fue modificada exitosamente. Ya podés iniciar sesión con tus nuevas credenciales.
                </div>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => navigate('/login', { replace: true })}
                style={{ justifyContent: 'center' }}
              >
                Iniciar sesión
              </button>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {userEmail && (
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', background: 'var(--hover)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                  Cuenta: <strong style={{ color: 'var(--ink-1)' }}>{userEmail}</strong>
                </div>
              )}
              <div className="form-field">
                <label>Nueva contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoFocus
                  autoComplete="new-password"
                />
              </div>
              <div className="form-field">
                <label>Confirmar nueva contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repetí la nueva contraseña"
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="spill bad" style={{ alignSelf: 'flex-start' }}>{Icon.alert} {error}</div>
              )}

              <button
                className="btn primary"
                type="submit"
                disabled={busy || !password || !confirmPassword}
                style={{ justifyContent: 'center' }}
              >
                {busy ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

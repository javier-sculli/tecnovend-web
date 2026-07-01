import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icons.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
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

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <form className="card" onSubmit={submit} style={{ width: 380, maxWidth: '90vw', padding: 4 }}>
        <div className="card-head" style={{ borderBottom: 'none' }}>
          <div>
            <div className="card-title" style={{ fontSize: 18 }}>VendPoint</div>
            <div className="card-sub">Iniciá sesión para gestionar tus máquinas</div>
          </div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="vos@empresa.com" autoFocus autoComplete="username" />
          </div>
          <div className="form-field">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" />
          </div>
          {error && (
            <div className="spill bad" style={{ alignSelf: 'flex-start' }}>{Icon.alert} {error}</div>
          )}
          <button className="btn primary" type="submit" disabled={busy || !email || !password} style={{ justifyContent: 'center' }}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  );
}

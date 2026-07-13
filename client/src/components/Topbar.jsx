import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { useAuth } from '../auth.jsx';
import { apiFetch } from '../api.js';

// Modal para cambiar contraseña
function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Error al cambiar la contraseña. Verificá tu contraseña actual.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Cambiar contraseña</div>
            <div className="modal-sub">Actualizá tu contraseña de acceso</div>
          </div>
          <button className="modal-close" onClick={onClose}>{Icon.x}</button>
        </div>

        {success ? (
          <div className="modal-body" style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--ok)', fontWeight: 500, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>✅</span>
            ¡Contraseña cambiada con éxito!
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {error && (
                <div style={{ color: 'var(--bad)', background: 'var(--bad-soft)', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
                  {error}
                </div>
              )}
              
              <div className="form-field">
                <label>Contraseña actual <span className="req">*</span></label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Tu contraseña actual"
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Nueva contraseña <span className="req">*</span></label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                />
              </div>

              <div className="form-field">
                <label>Confirmar nueva contraseña <span className="req">*</span></label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repetí la nueva contraseña"
                  required
                />
              </div>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={loading || !currentPassword || !newPassword || !confirmPassword}>
                Guardar cambios
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

// Selector de organización (single-select).
function OrgSwitcher() {
  const { orgs, orgId, currentOrg, selectOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!orgs?.length) return null;

  return (
    <div className="org-switch" ref={ref} style={{ position: 'relative' }}>
      <button className="filter-btn" onClick={() => setOpen(o => !o)} title="Cambiar organización">
        {Icon.building}
        <span className="value" style={{ marginLeft: 6 }}>{currentOrg?.name || 'Elegí organización'}</span>
        {Icon.chevDown}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 60, minWidth: 200, background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
          {orgs.map(o => (
            <button
              key={o.id}
              onClick={() => { selectOrg(o.id); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10, padding: '8px 10px', borderRadius: 6, background: o.id === orgId ? 'var(--hover)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink-1)' }}
            >
              <span>{o.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="spill" style={{ fontSize: 10 }}>{o.role}</span>
                {o.id === orgId && Icon.check}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [showChangePass, setShowChangePass] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;
  const initials = (user.name || user.email).split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} title={user.email}
        style={{ width: 30, height: 30, borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
        {initials}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '120%', right: 0, zIndex: 60, minWidth: 200, background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line-2)', marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{user.email}</div>
          </div>
          
          <button onClick={() => { setShowChangePass(true); setOpen(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)', textAlign: 'left', marginBottom: 2 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {Icon.lock} Cambiar contraseña
          </button>

          <button onClick={logout}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--bad)', textAlign: 'left' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bad-soft)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {Icon.unplug} Cerrar sesión
          </button>
        </div>
      )}
      {showChangePass && <ChangePasswordModal onClose={() => setShowChangePass(false)} />}
    </div>
  );
}

export default function Topbar({ envProd, onEnvToggle, crumbs = ["Operación", "Dashboard"], rightSlot }) {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "here" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="env-switch" onClick={onEnvToggle} title="Cambiar entorno" style={{ marginLeft: 8 }}>
        <span className={"env-pill " + (envProd ? "prod" : "test")}>
          <span className="d"></span>
          {envProd ? "Producción" : "Sandbox · TEST"}
        </span>
      </div>
      <div className="search">
        {Icon.search}
        <input placeholder="Buscar máquina, sede, pos_id, mp_payment_id…" />
        <kbd>⌘K</kbd>
      </div>
      <div className="top-actions">
        <OrgSwitcher />
        <button className="icon-btn" title="Notificaciones">
          {Icon.bell}<span className="ping"></span>
        </button>
        {rightSlot}
        <UserMenu />
      </div>
    </header>
  );
}

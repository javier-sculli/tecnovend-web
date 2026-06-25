import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { useAuth } from '../auth.jsx';

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
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 60, minWidth: 200, background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
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
        <div style={{ position: 'absolute', top: '120%', right: 0, zIndex: 60, minWidth: 200, background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line-2)' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 500 }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{user.email}</div>
          </div>
          <button onClick={logout}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--bad)' }}>
            {Icon.unplug} Cerrar sesión
          </button>
        </div>
      )}
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

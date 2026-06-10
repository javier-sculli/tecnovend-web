import React from 'react';
import { Icon } from './Icons.jsx';

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
        <button className="icon-btn" title="Notificaciones">
          {Icon.bell}<span className="ping"></span>
        </button>
        {rightSlot}
      </div>
    </header>
  );
}

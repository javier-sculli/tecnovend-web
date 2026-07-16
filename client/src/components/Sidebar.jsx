import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { apiFetch } from '../api.js';

// En mobile la sidebar es un drawer (oculto por default, se abre con el botón
// hamburguesa que dibuja este mismo componente). En desktop el CSS la deja
// siempre visible y el botón/overlay quedan con display:none.
export default function Sidebar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Cantidad real de máquinas del cliente activo. Antes era un "47" fijo en
  // el código — mostraba ese número para cualquier cliente, aunque no
  // tuviera ninguna máquina. Cambiar de cliente hace un reload completo
  // (ver selectOrg en auth.jsx), así que alcanza con pedirlo al montar.
  const [machineCount, setMachineCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/machines')
      .then(data => { if (!cancelled) setMachineCount(data.length); })
      .catch(() => { if (!cancelled) setMachineCount(null); });
    return () => { cancelled = true; };
  }, []);

  const navOps = [
    // Clientes oculto por ahora
    { id: "maquinas",  ico: Icon.machine, label: "Máquinas",        href: "/maquinas", count: machineCount },
    { id: "pagos",     ico: Icon.card,    label: "Pagos · MP",      href: "/pagos", dot: true },
    { id: "reportes",  ico: Icon.chart,   label: "Reportes",        href: "/reportes" },
  ];

  const navSys = [
    { ico: Icon.cog,     label: "Configuración" }
  ];

  return (
    <>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={open}
      >
        {open ? Icon.x : Icon.menu}
      </button>
      {open && <div className="sidebar-backdrop" onClick={close} />}
      <aside className={"sidebar" + (open ? " open" : "")}>
        <Link to="/" className="brand-row" style={{ textDecoration: "none", color: "inherit" }} onClick={close}>
          <div className="brand-mark" aria-hidden></div>
          <div>
            <div className="brand-name">VendPoint</div>
            <div className="brand-tag">v1.0</div>
          </div>
        </Link>

        <div className="nav-section">Operación</div>
        {navOps.map((n, i) => {
          if (n.href === "#") {
            return (
              <a key={i} href="#" className="nav-item" onClick={close}>
                {n.ico}
                <span>{n.label}</span>
                {n.count != null && <span className="nav-count">{n.count}</span>}
              </a>
            );
          }
          return (
            <NavLink
              key={i}
              to={n.href}
              onClick={close}
              className={({ isActive }) => {
                const active = isActive || (n.href !== '/' && location.pathname.startsWith(n.href));
                return "nav-item " + (active ? "active" : "");
              }}
            >
              {n.ico}
              <span>{n.label}</span>
              {n.count != null && <span className="nav-count">{n.count}</span>}
              {n.dot && <span className="nav-dot" />}
            </NavLink>
          );
        })}

        <div className="nav-section">Sistema</div>
        {navSys.map((n, i) => (
          <a key={i} href="#" className="nav-item" onClick={close}>
            {n.ico}
            <span>{n.label}</span>
          </a>
        ))}
      </aside>
    </>
  );
}

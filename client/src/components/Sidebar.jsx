import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { apiFetch } from '../api.js';
import { useAuth } from '../auth.jsx';

// En mobile la sidebar es un drawer (oculto por default, se abre con el botón
// hamburguesa que dibuja este mismo componente). En desktop el CSS la deja
// siempre visible y el botón/overlay quedan con display:none.
export default function Sidebar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const { orgs } = useAuth();
  const isSuperAdmin = orgs.some(o => o.id === 'cli_87c461' && o.role === 'administrador');

  // Cantidad real de máquinas del cliente activo.
  const [machineCount, setMachineCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/machines')
      .then(data => { if (!cancelled) setMachineCount(data.length); })
      .catch(() => { if (!cancelled) setMachineCount(null); });
    return () => { cancelled = true; };
  }, []);

  const navOps = [
    { id: "maquinas",  ico: Icon.machine, label: "Máquinas",        href: "/maquinas", count: machineCount },
    { id: "pagos",     ico: Icon.card,    label: "Pagos · MP",      href: "/pagos", dot: true },
    { id: "reportes",  ico: Icon.chart,   label: "Reportes",        href: "/reportes" },
  ];

  if (isSuperAdmin) {
    navOps.push({ id: "clientes", ico: Icon.building, label: "Clientes", href: "/clientes" });
  }

  const navSys = [
    { ico: Icon.cog,     label: "Configuración", href: "/configuracion" }
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
          <NavLink
            key={i}
            to={n.href}
            onClick={close}
            className={({ isActive }) => {
              const active = isActive || location.pathname.startsWith(n.href);
              return "nav-item " + (active ? "active" : "");
            }}
          >
            {n.ico}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </aside>
    </>
  );
}

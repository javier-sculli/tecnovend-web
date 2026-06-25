import React from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Icon } from './Icons.jsx';

export default function Sidebar() {
  const location = useLocation();
  const navOps = [
    // Dashboard y Clientes ocultos por ahora (las páginas siguen en el código,
    // se reactivan agregándolos acá y restaurando sus rutas en App.jsx).
    { id: "maquinas",  ico: Icon.machine, label: "Máquinas",        href: "/maquinas", count: 47 },
    { id: "pagos",     ico: Icon.card,    label: "Pagos · MP",      href: "/pagos", dot: true },
    { id: "reportes",  ico: Icon.chart,   label: "Reportes",        href: "#" },
  ];

  const navDev = [
    { id: "qr-tester", ico: Icon.qr, label: "QR · Tester", href: "/qr-tester" },
  ];

  const navSys = [
    { ico: Icon.cog,     label: "Configuración" }
  ];

  return (
    <aside className="sidebar">
      <Link to="/" className="brand-row" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="brand-mark" aria-hidden></div>
        <div>
          <div className="brand-name">Tecnovend</div>
          <div className="brand-tag">Vending OS · v1.0</div>
        </div>
      </Link>

      <div className="nav-section">Operación</div>
      {navOps.map((n, i) => {
        if (n.href === "#") {
          return (
            <a key={i} href="#" className="nav-item">
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

      <div className="nav-section">Desarrollo</div>
      {navDev.map((n, i) => (
        <NavLink
          key={i}
          to={n.href}
          className={({ isActive }) => "nav-item " + (isActive ? "active" : "")}
        >
          {n.ico}
          <span>{n.label}</span>
        </NavLink>
      ))}

      <div className="nav-section">Sistema</div>
      {navSys.map((n, i) => (
        <a key={i} href="#" className="nav-item">
          {n.ico}
          <span>{n.label}</span>
        </a>
      ))}

      <div className="sidebar-foot">
        <div className="avatar">JS</div>
        <div className="user-meta">
          <div className="user-name">Javier Sculli</div>
          <div className="user-org">Tecnovend · Admin</div>
        </div>
      </div>
    </aside>
  );
}

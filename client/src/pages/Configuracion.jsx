import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ClientDetail } from './Clientes.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';

export default function Configuracion() {
  const { orgId } = useAuth();
  const [envProd, setEnvProd] = useState(true);

  if (!orgId) {
    return (
      <div className="app">
        <Sidebar />
        <div className="main">
          <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={['Sistema', 'Configuración']} />
          <div className="page" style={{ padding: 24, color: 'var(--ink-4)', fontSize: 13 }}>
            Seleccioná un cliente activo para ver su configuración.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={['Sistema', 'Configuración']} />
        <ClientDetail id={orgId} hideBackBtn={true} />
      </div>
    </div>
  );
}

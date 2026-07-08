import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
// Clientes oculto por ahora
import Dashboard from './pages/Dashboard.jsx';
// import Clientes from './pages/Clientes.jsx';
import Maquinas from './pages/Maquinas.jsx';
import Pagos from './pages/Pagos.jsx';

// Gate de autenticación: sin sesión → /login (recordando a dónde iba).
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>Cargando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/maquinas" replace /> : <Login />} />
      {/* Default → Máquinas (Dashboard oculto por ahora) */}
      <Route path="/" element={<Navigate to="/maquinas" replace />} />
      {/* <Route path="/clientes" element={<RequireAuth><Clientes /></RequireAuth>} /> */}
      {/* <Route path="/clientes/:id" element={<RequireAuth><Clientes /></RequireAuth>} /> */}
      <Route path="/maquinas" element={<RequireAuth><Maquinas /></RequireAuth>} />
      <Route path="/maquinas/:id" element={<RequireAuth><Maquinas /></RequireAuth>} />
      <Route path="/pagos" element={<RequireAuth><Pagos /></RequireAuth>} />
      <Route path="/reportes" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

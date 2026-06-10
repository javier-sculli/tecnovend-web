import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Clientes from './pages/Clientes.jsx';
import Maquinas from './pages/Maquinas.jsx';
import Pagos from './pages/Pagos.jsx';
import QRTester from './pages/QRTester.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/clientes" element={<Clientes />} />
      <Route path="/clientes/:id" element={<Clientes />} />
      <Route path="/maquinas" element={<Maquinas />} />
      <Route path="/maquinas/:id" element={<Maquinas />} />
      <Route path="/pagos" element={<Pagos />} />
      <Route path="/qr-tester" element={<QRTester />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

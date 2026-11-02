import React, { useState, useEffect, useMemo } from 'react';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import AlertModal from '../components/AlertModal.jsx';
import { apiFetch } from '../api.js';

/* ============================================================
   Parser de CSV / TSV / Texto Copiado
   ============================================================ */
function parseEmployeeSpreadsheet(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Autodetectar delimitador: coma, punto y coma o tab
  const firstLine = lines[0];
  let delim = ',';
  if (firstLine.includes(';') && !firstLine.includes(',')) delim = ';';
  else if (firstLine.includes('\t')) delim = '\t';
  else if (firstLine.includes(';') && firstLine.split(';').length > firstLine.split(',').length) delim = ';';

  // Helper para split respetando comillas básicas
  const splitRow = (rowStr) => rowStr.split(delim).map(cell => cell.replace(/^["']|["']$/g, '').trim());

  let headerIndex = -1;
  let colMap = { dni: -1, email: -1, name: -1, discountPct: -1 };

  // Buscar encabezado
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cells = splitRow(lines[i]).map(c => c.toLowerCase());
    const dIdx = cells.findIndex(c => c.includes('dni') || c.includes('documento') || c.includes('cuil') || c.includes('cuit'));
    const eIdx = cells.findIndex(c => c.includes('email') || c.includes('mail') || c.includes('correo'));
    const nIdx = cells.findIndex(c => c.includes('nombre') || c.includes('name') || c.includes('empleado') || c.includes('persona'));
    const pIdx = cells.findIndex(c => c.includes('descuento') || c.includes('%') || c.includes('pct') || c.includes('porcentaje'));

    if (dIdx !== -1 || eIdx !== -1) {
      headerIndex = i;
      colMap = { dni: dIdx, email: eIdx, name: nIdx, discountPct: pIdx };
      break;
    }
  }

  const dataLines = headerIndex !== -1 ? lines.slice(headerIndex + 1) : lines;
  const parsed = [];

  for (const line of dataLines) {
    const cells = splitRow(line);
    if (cells.length === 0 || cells.every(c => !c)) continue;

    let dni = colMap.dni !== -1 ? cells[colMap.dni] : null;
    let email = colMap.email !== -1 ? cells[colMap.email] : null;
    let name = colMap.name !== -1 ? cells[colMap.name] : null;
    let discountPct = colMap.discountPct !== -1 ? cells[colMap.discountPct] : null;

    // Si no hubo encabezado identificado, intentar inferir por contenido de celdas
    if (headerIndex === -1) {
      dni = cells.find(c => /^\d{7,11}$/.test(c.replace(/\D/g, ''))) || null;
      email = cells.find(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) || null;
      name = cells.find(c => c !== dni && c !== email && /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(c)) || null;
    }

    // Normalizar
    const cleanDni = dni ? dni.replace(/[^\d]/g, '') : null;
    const cleanEmail = email && email.includes('@') ? email.toLowerCase() : null;
    const cleanPct = discountPct ? parseInt(discountPct.replace(/\D/g, ''), 10) : null;

    if (cleanEmail || cleanDni) {
      parsed.push({
        dni: cleanDni,
        email: cleanEmail,
        name: name || null,
        discountPct: Number.isFinite(cleanPct) && cleanPct > 0 && cleanPct <= 100 ? cleanPct : null,
      });
    }
  }

  return parsed;
}

/* ============================================================
   Modal para agregar / editar empleado individual
   ============================================================ */
function EmployeeModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [dni, setDni] = useState(initial?.dni || '');
  const [discountPct, setDiscountPct] = useState(initial?.discount_pct || initial?.discountPct || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() && !dni.trim()) {
      setError('Debés ingresar al menos un Email o DNI');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        id: initial?.id,
        name: name.trim() || null,
        email: email.trim() || null,
        dni: dni.trim() || null,
        discountPct: discountPct !== '' ? Number(discountPct) : null,
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="card" style={{ width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <div className="card-title">{initial ? 'Editar empleado' : 'Nuevo empleado'}</div>
          <button className="link-btn" onClick={onClose}>{Icon.x}</button>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#ef4444', fontSize: 13, border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
          <div className="form-field">
            <label>Nombre del empleado</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan Pérez" autoFocus />
          </div>
          <div className="form-field">
            <label>Email de Mercado Pago</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ej: juan.perez@gmail.com" />
          </div>
          <div className="form-field">
            <label>DNI / Documento</label>
            <input value={dni} onChange={e => setDni(e.target.value)} placeholder="Ej: 38123456" />
          </div>
          <div className="form-field">
            <label>% Descuento personalizado <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(Opcional, dejas en blanco para usar el % general)</span></label>
            <input type="number" min="1" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)} placeholder="Ej: 20" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={submit} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar empleado'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Pantalla Principal: Descuentos a Empleados
   ============================================================ */
export default function Descuentos() {
  const [envProd, setEnvProd] = useState(true);
  const [activeTab, setActiveTab] = useState('nomina'); // 'nomina' | 'dashboard'

  // Config del cliente
  const [config, setConfig] = useState({ enabled: false, defaultDiscountPct: 20 });
  const [pctInput, setPctInput] = useState('20');
  const [savingPct, setSavingPct] = useState(false);

  // Lista de empleados
  const [employees, setEmployees] = useState([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empPage, setEmpPage] = useState(1);
  const [empTotalPages, setEmpTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loadingEmp, setLoadingEmp] = useState(true);

  // Lista de máquinas (Tab Máquinas)
  const [machines, setMachines] = useState([]);
  const [loadingMachines, setLoadingMachines] = useState(false);

  // Stats y Logs (Tab Dashboard)
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [loadingStats, setLoadingStats] = useState(false);

  // Carga masiva (CSV Preview Modal)
  const [previewRows, setPreviewRows] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Modales
  const [editEmployee, setEditEmployee] = useState(null);
  const [showNewEmpModal, setShowNewEmpModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', description: '', confirmText: 'Confirmar', variant: 'danger', onConfirm: () => {} });
  const [alertModal, setAlertModal] = useState({ isOpen: false, title: '', message: '', type: 'info' });

  const showAlert = (message, type = 'error', title = '') => {
    setAlertModal({ isOpen: true, message, type, title });
  };

  const showConfirm = ({ title, description, confirmText, variant = 'danger', onConfirm }) => {
    setConfirmModal({ isOpen: true, title, description, confirmText, variant, onConfirm });
  };

  // Cargar config del cliente
  const loadConfig = async () => {
    try {
      const data = await apiFetch('/api/employee-discounts/config');
      setConfig(data);
      setPctInput(String(data.defaultDiscountPct ?? 20));
    } catch (e) {
      console.error(e);
    }
  };

  // Cargar empleados
  const loadEmployees = async (page = 1, searchQuery = search) => {
    setLoadingEmp(true);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '50' });
      if (searchQuery.trim()) query.set('search', searchQuery.trim());

      const data = await apiFetch(`/api/employee-discounts/employees?${query.toString()}`);
      setEmployees(data.employees || []);
      setEmpTotal(data.total || 0);
      setEmpPage(data.page || 1);
      setEmpTotalPages(data.totalPages || 1);
    } catch (e) {
      showAlert('Error al cargar nómina de empleados: ' + e.message, 'error');
    } finally {
      setLoadingEmp(false);
    }
  };

  // Cargar stats y logs para el dashboard
  const loadDashboardData = async (page = 1) => {
    setLoadingStats(true);
    try {
      const [sData, lData] = await Promise.all([
        apiFetch('/api/employee-discounts/stats'),
        apiFetch(`/api/employee-discounts/logs?page=${page}&limit=20`),
      ]);
      setStats(sData);
      setLogs(lData.logs || []);
      setLogsTotal(lData.total || 0);
      setLogsPage(lData.page || 1);
      setLogsTotalPages(lData.totalPages || 1);
    } catch (e) {
      showAlert('Error al cargar datos del dashboard: ' + e.message, 'error');
    } finally {
      setLoadingStats(false);
    }
  };

  // Cargar máquinas para el Tab Máquinas
  const loadMachines = async () => {
    setLoadingMachines(true);
    try {
      const data = await apiFetch('/api/employee-discounts/machines');
      setMachines(data.machines || []);
    } catch (e) {
      showAlert('Error al cargar máquinas: ' + e.message, 'error');
    } finally {
      setLoadingMachines(false);
    }
  };

  const toggleMachineDiscount = async (machineId, currentStatus) => {
    try {
      await apiFetch(`/api/employee-discounts/machines/${machineId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentStatus }),
      });
      setMachines(prev => prev.map(m => m.id === machineId ? { ...m, employee_discount_enabled: !currentStatus ? 1 : 0 } : m));
    } catch (e) {
      showAlert('Error al actualizar máquina: ' + e.message, 'error');
    }
  };

  const printCombinedForMachine = async (m) => {
    try {
      let mpImg = null;
      try {
        const pos = await apiFetch(`/api/mp/pos/${m.id}`);
        mpImg = pos?.qr_code_base64 ? `data:image/png;base64,${pos.qr_code_base64}` : (pos?.qr?.image || null);
      } catch (_) {}

      const empUrl = `${window.location.origin}/e/${m.id}`;
      const empQrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(empUrl)}`;

      const vendPointLogoHtml = `
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:14px">
          <div style="width:36px;height:36px;border-radius:10px;background:radial-gradient(120% 120% at 0% 0%, #ed7a3a 0%, #c2410c 55%, #7c2d12 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.12)">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="3" width="14" height="18" rx="2"/>
              <line x1="9" y1="7" x2="15" y2="7"/>
              <line x1="9" y1="11" x2="15" y2="11"/>
              <rect x="13" y="14" width="4" height="4" rx="0.5"/>
            </svg>
          </div>
          <div style="text-align:left">
            <div style="font-size:24px;font-weight:900;letter-spacing:-0.5px;color:#18181b;line-height:1">VendPoint</div>
            <div style="font-size:9.5px;font-weight:800;letter-spacing:1.5px;color:#71717a;text-transform:uppercase;margin-top:3px">PAGOS INTELIGENTES</div>
          </div>
        </div>
      `;

      const w = window.open('', '_blank');
      w.document.write(`
        <html><head><title>Cartel QR · ${m.name}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin: 0; background: #fff; }
          .card { border: 2px solid #18181b; border-radius: 16px; padding: 24px; max-width: 640px; text-align: center; }
          .grid { display: flex; gap: 24px; justify-content: center; margin-top: 16px; }
          .box { border: 1px solid #d4d4d8; border-radius: 12px; padding: 16px; flex: 1; max-width: 260px; }
          h1 { margin: 0 0 4px; font-size: 20px; color: #18181b; }
          h2 { margin: 8px 0 4px; font-size: 15px; }
          img { width: 200px; height: 200px; display: block; margin: 0 auto; }
          .badge { background: #009ee3; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 6px; font-size: 12px; display: inline-block; }
          .badge-emp { background: #10b981; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 6px; font-size: 12px; display: inline-block; }
          .sub { font-size: 12px; color: #71717a; margin-top: 8px; }
        </style></head>
        <body>
          <div class="card">
            ${vendPointLogoHtml}
            <h1>${m.name}</h1>
            <p style="margin: 0 0 16px; color: #71717a; font-size: 13.5px;">Elegí cómo abonar tu consumo en este equipo</p>
            <div class="grid">
              <div class="box">
                <span class="badge">Público General</span>
                <h2>Mercado Pago</h2>
                ${mpImg ? `<img src="${mpImg}" />` : '<p style="color:#999;font-size:12px;padding:40px 0">Sin QR Mercado Pago</p>'}
                <div class="sub">${m.qr_mode === 'fixed' ? `Precio: $${m.qr_fixed_amount}` : 'Escaneá e ingresá el monto'}</div>
              </div>
              <div class="box" style="border-color: #10b981; background: #f0fdf4;">
                <span class="badge-emp">Beneficio Corporativo</span>
                <h2>Exclusivo Empleados</h2>
                <img src="${empQrSrc}" />
                <div class="sub">Escaneá con tu celular para pagar con descuento</div>
              </div>
            </div>
            <div style="margin-top: 18px; padding-top: 10px; border-top: 1px dashed #e4e4e7; font-size: 11px; color: #a1a1aa;">
              Terminal ID: ${m.id} · Operado por VendPoint (vendpoint.com.ar)
            </div>
          </div>
          <script>setTimeout(() => window.print(), 350);</script>
        </body></html>`);
      w.document.close();
    } catch (e) {
      showAlert('No se pudo abrir el cartel para imprimir: ' + e.message, 'error');
    }
  };

  const downloadTemplate = () => {
    const csvContent = "DNI,Email MP,Nombre,% Descuento\n12345678,empleado@empresa.com,Juan Perez,20\n87654321,maria@empresa.com,Maria Gomez,25";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', 'plantilla_empleados_descuentos.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadConfig();
    loadEmployees(1, '');
  }, []);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData(1);
    } else if (activeTab === 'maquinas') {
      loadMachines();
    }
  }, [activeTab]);

  // Guardar porcentaje general
  const savePct = async () => {
    const val = Number(pctInput);
    if (!val || val < 1 || val > 100) {
      showAlert('Ingresá un porcentaje válido entre 1% y 100%', 'warn', 'Atención');
      return;
    }
    setSavingPct(true);
    try {
      await apiFetch('/api/employee-discounts/config', {
        method: 'PUT',
        body: JSON.stringify({ defaultDiscountPct: val }),
      });
      setConfig(c => ({ ...c, defaultDiscountPct: val }));
      showAlert('Porcentaje de descuento por defecto actualizado.', 'success', 'Éxito');
    } catch (e) {
      showAlert('Error al guardar porcentaje: ' + e.message, 'error');
    } finally {
      setSavingPct(false);
    }
  };

  // Manejar lectura de archivo CSV/Excel subido
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      const parsed = parseEmployeeSpreadsheet(content);
      if (parsed.length === 0) {
        showAlert('No se pudieron encontrar registros válidos en el archivo. Asegurate de incluir columnas con Email o DNI.', 'warn', 'Archivo no reconocido');
      } else {
        setPreviewRows(parsed);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  // Confirmar carga masiva
  const confirmBulkUpload = async (mode) => {
    if (!previewRows || previewRows.length === 0) return;
    setUploading(true);
    try {
      const res = await apiFetch('/api/employee-discounts/employees/upload', {
        method: 'POST',
        body: JSON.stringify({ employees: previewRows, mode }),
      });
      showAlert(`Se importaron ${res.imported} empleados correctamente (${mode === 'replace' ? 'Nómina reemplazada' : 'Nómina actualizada'}).`, 'success', 'Carga exitosa');
      setPreviewRows(null);
      loadEmployees(1);
    } catch (e) {
      showAlert('Error al importar planilla: ' + e.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  // Guardar empleado individual
  const handleSaveEmployee = async (empData) => {
    await apiFetch('/api/employee-discounts/employees', {
      method: 'POST',
      body: JSON.stringify(empData),
    });
    loadEmployees(empPage);
  };

  // Eliminar empleado individual
  const handleDeleteEmployee = (emp) => {
    showConfirm({
      title: 'Eliminar Empleado',
      description: `¿Estás seguro de eliminar a "${emp.name || emp.email || emp.dni}" de la nómina de descuentos?`,
      confirmText: 'Eliminar',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await apiFetch(`/api/employee-discounts/employees/${emp.id}`, { method: 'DELETE' });
          loadEmployees(empPage);
        } catch (e) {
          showAlert('Error al eliminar empleado: ' + e.message, 'error');
        }
      },
    });
  };

  // Vaciar nómina completa
  const handleClearAll = () => {
    showConfirm({
      title: 'Vaciar Nómina Completa',
      description: `¿Estás seguro de ELIMINAR TODOS los empleados registrados de esta organización (${empTotal} empleados)?\n\nLos empleados ya no recibirán el beneficio de reembolso automático hasta que subas una nueva planilla.`,
      confirmText: 'Vaciar Nómina',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await apiFetch('/api/employee-discounts/employees', { method: 'DELETE' });
          loadEmployees(1);
          showAlert('Nómina de empleados vaciada correctamente.', 'info', 'Nómina vaciada');
        } catch (e) {
          showAlert('Error al vaciar nómina: ' + e.message, 'error');
        }
      },
    });
  };

  const crumbs = ['Operación', 'Beneficios · Descuentos'];

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={crumbs} />

        <div className="page" data-screen-label="Descuentos a Empleados">
          {/* Header principal */}
          <div className="page-head" style={{ marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 className="page-title">Descuentos a Empleados</h1>
                <span className={`spill ${config.enabled ? 'ok' : 'normal'}`}>
                  {config.enabled ? 'Módulo Activo' : 'Módulo Inactivo'}
                </span>
                {config.enabled && (
                  <span
                    className={`spill ${Number(config.enabledMachines || 0) > 0 ? 'ok' : 'warn'}`}
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setActiveTab('maquinas')}
                    title="Clic para gestionar máquinas habilitadas"
                  >
                    {config.enabledMachines ?? 0} de {config.totalMachines ?? 0} máquinas habilitadas
                  </span>
                )}
              </div>
              <div className="page-subtitle">
                Programa de beneficios corporativos mediante QR exclusivo para empleados y pago bonificado.
              </div>
            </div>
          </div>

          {/* Tabs Selector */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            <button
              className={`btn ${activeTab === 'nomina' ? 'primary' : 'secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
              onClick={() => setActiveTab('nomina')}
            >
              {Icon.user} Nómina de Empleados
            </button>
            <button
              className={`btn ${activeTab === 'maquinas' ? 'primary' : 'secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
              onClick={() => setActiveTab('maquinas')}
            >
              {Icon.machine} Máquinas Habilitadas y QRs
            </button>
            <button
              className={`btn ${activeTab === 'dashboard' ? 'primary' : 'secondary'}`}
              style={{ borderRadius: '8px 8px 0 0', borderBottom: 'none' }}
              onClick={() => setActiveTab('dashboard')}
            >
              {Icon.chart} Dashboard de Consumo
            </button>
          </div>

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 1: NÓMINA Y CONFIGURACIÓN */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'nomina' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Card de Configuración y Carga Masiva */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                {/* % por defecto */}
                <div className="card" style={{ padding: 20 }}>
                  <div className="card-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    Porcentaje de Descuento Base
                  </div>
                  <div className="card-sub" style={{ marginBottom: 14 }}>
                    Es el porcentaje de cashback por defecto que recibe cada empleado al comprar.
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div className="form-field" style={{ flex: 1, margin: 0 }}>
                      <input
                        type="number" min="1" max="100"
                        value={pctInput}
                        onChange={e => setPctInput(e.target.value)}
                        placeholder="20"
                      />
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>%</span>
                    <button className="btn primary" onClick={savePct} disabled={savingPct}>
                      {savingPct ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>

                {/* Subir Planilla CSV */}
                <div className="card" style={{ padding: 20 }}>
                  <div className="card-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    Cargar Planilla de Empleados
                  </div>
                  <div className="card-sub" style={{ marginBottom: 14 }}>
                    Subí un archivo CSV o Excel con columnas de DNI, Email MP y Nombre.
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label className="btn primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      {Icon.plus} Seleccionar archivo CSV
                      <input type="file" accept=".csv,.txt,.tsv,.xlsx" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    <button className="btn secondary" onClick={downloadTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {Icon.download} Descargar template
                    </button>
                  </div>
                </div>
              </div>

              {/* Vista previa de Planilla subida (Modal Inline) */}
              {previewRows && (
                <div className="card" style={{ padding: 20, border: '2px solid var(--accent)', background: 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div className="card-title" style={{ color: 'var(--accent)' }}>Vista previa de la planilla subida</div>
                      <div className="card-sub">Se identificaron <strong>{previewRows.length} registros válidos</strong> listos para importar.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={() => setPreviewRows(null)}>Cancelar</button>
                      <button className="btn secondary" onClick={() => confirmBulkUpload('append')} disabled={uploading}>
                        Agregar a existentes
                      </button>
                      <button className="btn primary" onClick={() => confirmBulkUpload('replace')} disabled={uploading}>
                        {uploading ? 'Importando…' : 'Reemplazar nómina completa'}
                      </button>
                    </div>
                  </div>

                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div className="dev-row head" style={{ position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                      <span>#</span>
                      <span>DNI</span>
                      <span>Email MP</span>
                      <span>Nombre</span>
                      <span>% Descuento</span>
                    </div>
                    {previewRows.slice(0, 50).map((r, i) => (
                      <div className="dev-row" key={i} style={{ padding: '8px 12px', fontSize: 13 }}>
                        <span style={{ color: 'var(--ink-4)' }}>{i + 1}</span>
                        <span className="mono">{r.dni || '—'}</span>
                        <span className="mono">{r.email || '—'}</span>
                        <span>{r.name || '—'}</span>
                        <span>{r.discountPct ? `${r.discountPct}%` : `${config.defaultDiscountPct}% (Default)`}</span>
                      </div>
                    ))}
                    {previewRows.length > 50 && (
                      <div style={{ padding: 8, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                        Y {previewRows.length - 50} filas más…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Lista de Empleados Registrados */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div className="card-title">Nómina de Empleados Activos ({empTotal})</div>
                    <div className="card-sub">Personas registradas que reciben reembolso automático al pagar en MP</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Buscador */}
                    <div className="form-field" style={{ margin: 0, width: 220 }}>
                      <input
                        placeholder="Buscar por DNI o Email…"
                        value={search}
                        onChange={e => {
                          setSearch(e.target.value);
                          loadEmployees(1, e.target.value);
                        }}
                      />
                    </div>
                    <button className="btn secondary small" onClick={() => { setEditEmployee(null); setShowNewEmpModal(true); }}>
                      {Icon.plus} Nuevo empleado
                    </button>
                    {empTotal > 0 && (
                      <button className="danger small" onClick={handleClearAll}>
                        {Icon.trash} Vaciar nómina
                      </button>
                    )}
                  </div>
                </div>

                <div className="dev-list emp-list">
                  <div className="dev-row head">
                    <span>Empleado</span>
                    <span>Email MP</span>
                    <span>DNI / Documento</span>
                    <span>% Descuento</span>
                    <span>Acciones</span>
                  </div>

                  {loadingEmp ? (
                    <div style={{ padding: '28px 18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando empleados…</div>
                  ) : employees.length === 0 ? (
                    <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                      Sin empleados registrados todavía.<br />
                      <span style={{ fontSize: 12 }}>Subí una planilla CSV o agregá uno manualmente con "Nuevo empleado".</span>
                    </div>
                  ) : employees.map(emp => (
                    <div className="dev-row" key={emp.id} style={{ padding: '12px 18px' }}>
                      <div className="name-cell">
                        <span className="n">{emp.name || 'Empleado sin nombre'}</span>
                        <span className="mono" style={{ fontSize: 11 }}>{emp.id}</span>
                      </div>
                      <div className="mono" style={{ color: 'var(--ink-1)' }}>
                        {emp.email || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                      </div>
                      <div className="mono" style={{ color: 'var(--ink-2)' }}>
                        {emp.dni || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                      </div>
                      <div>
                        <span className="spill ok">
                          {emp.discount_pct ? `${emp.discount_pct}%` : `${config.defaultDiscountPct}% (Base)`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="link-btn" title="Editar" onClick={() => setEditEmployee(emp)}>
                          {Icon.edit}
                        </button>
                        <button className="link-btn" title="Eliminar" onClick={() => handleDeleteEmployee(emp)} style={{ color: 'var(--bad)' }}>
                          {Icon.trash}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Paginador */}
                {empTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Página {empPage} de {empTotalPages}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn secondary small" disabled={empPage <= 1} onClick={() => loadEmployees(empPage - 1)}>Anterior</button>
                      <button className="btn secondary small" disabled={empPage >= empTotalPages} onClick={() => loadEmployees(empPage + 1)}>Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 2: MÁQUINAS HABILITADAS Y QRs */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'maquinas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div className="card-title" style={{ fontSize: 16, fontWeight: 600 }}>Máquinas con Beneficio Habilitado</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 2 }}>
                      Elegí en qué máquinas de la organización aplica el descuento e imprimí su cartel QR para colocar en el equipo.
                    </div>
                  </div>
                  <button className="btn" onClick={loadMachines} disabled={loadingMachines}>
                    Actualizar
                  </button>
                </div>

                {loadingMachines ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)' }}>Cargando máquinas…</div>
                ) : machines.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No hay máquinas registradas en esta organización.
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink-4)', fontSize: 12 }}>
                          <th style={{ padding: '10px 12px' }}>Máquina</th>
                          <th style={{ padding: '10px 12px' }}>Ubicación</th>
                          <th style={{ padding: '10px 12px' }}>Modo / Precio</th>
                          <th style={{ padding: '10px 12px' }}>Estado</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center' }}>Beneficio Empleados</th>
                          <th style={{ padding: '10px 12px', textAlign: 'right' }}>Cartel QR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machines.map((m) => {
                          const isEnabled = Boolean(m.employee_discount_enabled);
                          return (
                            <tr key={m.id} style={{ borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                              <td style={{ padding: '12px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{m.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{m.id}</div>
                              </td>
                              <td style={{ padding: '12px', color: 'var(--ink-3)' }}>
                                {m.location || '—'}
                              </td>
                              <td style={{ padding: '12px' }}>
                                <span className={`spill ${m.qr_mode === 'fixed' ? 'ok' : 'normal'}`}>
                                  {m.qr_mode === 'fixed' ? `Fijo $${m.qr_fixed_amount}` : 'Libre'}
                                </span>
                              </td>
                              <td style={{ padding: '12px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.status === 'active' ? '#10b981' : '#ef4444' }} />
                                  {m.status === 'active' ? 'Operativa' : 'Mantenimiento'}
                                </span>
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className={`switch ${isEnabled ? 'on' : ''}`}
                                  onClick={() => toggleMachineDiscount(m.id, isEnabled)}
                                  title={isEnabled ? 'Desactivar descuento' : 'Activar descuento'}
                                />
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: 8 }}>
                                  <a
                                    className="btn"
                                    href={`/e/${m.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: 12, padding: '5px 10px' }}
                                    title="Abrir vista de empleado en nueva pestaña"
                                  >
                                    Ver Web
                                  </a>
                                  <button
                                    className="btn primary"
                                    style={{ fontSize: 12, padding: '5px 12px' }}
                                    onClick={() => printCombinedForMachine(m)}
                                  >
                                    🖨 Imprimir Cartel
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 3: DASHBOARD DE CONSUMOS */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Tarjetas KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4 }}>Total Bonificado / Ahorrado ($)</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--good)' }}>
                    ${(stats?.totalRefunded || 0).toLocaleString('es-AR')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Ahorro acumulado por empleados</div>
                </div>

                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4 }}>Compras con Descuento</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink-1)' }}>
                    {stats?.totalTransactions || 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Transacciones completadas</div>
                </div>

                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4 }}>Empleados Beneficiados</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink-1)' }}>
                    {stats?.uniqueEmployees || 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Usuarios únicos que compraron</div>
                </div>

                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500, marginBottom: 4 }}>Reembolso Promedio</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent)' }}>
                    ${(stats?.avgRefund || 0).toLocaleString('es-AR')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Por transacción realizada</div>
                </div>
              </div>

              {/* Ranking Top Empleados */}
              {stats?.topEmployees?.length > 0 && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="card-head">
                    <div>
                      <div className="card-title">Top Empleados por Consumo</div>
                      <div className="card-sub">Mayores beneficiados del programa de descuentos</div>
                    </div>
                  </div>
                  <div className="dev-list top-emp-list">
                    <div className="dev-row head">
                      <span>Empleado</span>
                      <span>Compras</span>
                      <span>Total Consumido</span>
                      <span>Total Ahorrado / Reembolsado</span>
                    </div>
                    {stats.topEmployees.map((t, idx) => (
                      <div className="dev-row" key={idx} style={{ padding: '10px 18px' }}>
                        <div className="name-cell">
                          <span className="n">{t.name}</span>
                          <span className="mono" style={{ fontSize: 11 }}>{t.email || t.dni || ''}</span>
                        </div>
                        <div className="mono">{t.tx_count} compras</div>
                        <div className="mono">${Number(t.total_spent || 0).toLocaleString('es-AR')}</div>
                        <div className="mono" style={{ color: 'var(--good)', fontWeight: 600 }}>
                          ${Number(t.total_discounted || 0).toLocaleString('es-AR')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bitácora Histórica de Descuentos */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="card-head">
                  <div>
                    <div className="card-title">Historial de Transacciones con Descuento ({logsTotal})</div>
                    <div className="card-sub">Registro detallado de reembolsos procesados por Mercado Pago</div>
                  </div>
                </div>

                <div className="dev-list logs-list">
                  <div className="dev-row head">
                    <span>Fecha</span>
                    <span>Empleado</span>
                    <span>Máquina</span>
                    <span>Monto Original</span>
                    <span>% Desc.</span>
                    <span>Reembolsado</span>
                    <span>Estado MP</span>
                  </div>

                  {loadingStats ? (
                    <div style={{ padding: '28px 18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando historial de consumos…</div>
                  ) : logs.length === 0 ? (
                    <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                      Sin transacciones con descuento registradas aún.
                    </div>
                  ) : logs.map(l => (
                    <div className="dev-row" key={l.id} style={{ padding: '10px 18px' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                        {l.created_at ? new Date(l.created_at).toLocaleString() : ''}
                      </div>
                      <div className="name-cell">
                        <span className="n">{l.employee_name || l.payer_email || l.payer_dni || 'Empleado'}</span>
                        <span className="mono" style={{ fontSize: 11 }}>{l.payer_email || l.payer_dni}</span>
                      </div>
                      <div style={{ color: 'var(--ink-2)' }}>{l.machine_name || l.machine_id || '—'}</div>
                      <div className="mono">${l.original_amount}</div>
                      <div><span className="spill ok">{l.discount_pct}%</span></div>
                      <div className="mono" style={{ color: 'var(--good)', fontWeight: 600 }}>
                        ${l.refund_amount}
                      </div>
                      <div>
                        <span className={`spill ${l.status === 'done' ? 'ok' : l.status === 'pending' ? 'warn' : 'bad'}`}>
                          {l.status === 'done' ? 'Reembolsado' : l.status === 'pending' ? 'Pendiente' : 'Error'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Paginador logs */}
                {logsTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Página {logsPage} de {logsTotalPages}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn secondary small" disabled={logsPage <= 1} onClick={() => loadDashboardData(logsPage - 1)}>Anterior</button>
                      <button className="btn secondary small" disabled={logsPage >= logsTotalPages} onClick={() => loadDashboardData(logsPage + 1)}>Siguiente</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modales */}
        {(showNewEmpModal || editEmployee) && (
          <EmployeeModal
            initial={editEmployee}
            onClose={() => { setShowNewEmpModal(false); setEditEmployee(null); }}
            onSave={handleSaveEmployee}
          />
        )}

        <ConfirmModal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(s => ({ ...s, isOpen: false }))}
          onConfirm={confirmModal.onConfirm}
          title={confirmModal.title}
          description={confirmModal.description}
          confirmText={confirmModal.confirmText}
          variant={confirmModal.variant}
        />

        <AlertModal
          isOpen={alertModal.isOpen}
          onClose={() => setAlertModal(s => ({ ...s, isOpen: false }))}
          title={alertModal.title}
          message={alertModal.message}
          type={alertModal.type}
        />
      </div>
    </div>
  );
}

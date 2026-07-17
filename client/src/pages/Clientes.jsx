import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { apiFetch } from '../api.js';
import { useAuth } from '../auth.jsx';

/* ============================================================
   Listado de clientes
   ============================================================ */
function ClientList({ clients, loading, onOpen, onNew, isSuperAdmin }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Clientes</div>
          <div className="card-sub">Operadores dueños de máquinas · datos de contacto</div>
        </div>
        {isSuperAdmin && (
          <button className="btn primary" onClick={onNew}>{Icon.plus} Nuevo cliente</button>
        )}
      </div>

      <div className="dev-list clients-list">
        <div className="dev-row head">
          <span></span>
          <span>Cliente</span>
          <span>Contacto</span>
          <span>Máquinas</span>
          <span></span>
        </div>

        {loading ? (
          <div style={{ padding: '28px 18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando clientes…</div>
        ) : clients.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
            Sin clientes todavía.<br />
            {isSuperAdmin && <span style={{ fontSize: 12 }}>Creá el primero con “Nuevo cliente”.</span>}
          </div>
        ) : clients.map(c => (
          <div className="dev-row" key={c.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(c.id)}>
            <div className="ico qr">{Icon.building}</div>
            <div className="name-cell">
              <span className="n">{c.name}</span>
              <span className="mono">{c.id}</span>
            </div>
            <div style={{ color: 'var(--ink-2)' }}>
              {c.contact_name || <span style={{ color: 'var(--ink-4)' }}>—</span>}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
              {Icon.machine}<span className="mono">{c.machine_count ?? 0}</span>
            </div>
            <button className="actions-menu" onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>{Icon.chev}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Modal nuevo cliente
   ============================================================ */
function NewClientModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), contact_name: contact.trim() || null });
      onClose();
    } catch (e) {
      alert('Error al crear cliente: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="card" style={{ width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <div className="card-title">Nuevo cliente</div>
          <button className="link-btn" onClick={onClose}>{Icon.x}</button>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label>Nombre del cliente <span className="req">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Hospital Italiano" autoFocus />
          </div>
          <div className="form-field">
            <label>Persona de contacto</label>
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Opcional" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={submit} disabled={saving || !name.trim()}>
              {saving ? 'Creando…' : 'Crear cliente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Modal nuevo usuario
   ============================================================ */
function NewUserModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operativo');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        email: email.trim(),
        password,
        role
      });
      onClose();
    } catch (e) {
      alert('Error al crear usuario: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div className="card" style={{ width: 420, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div className="card-head">
          <div className="card-title">Nuevo usuario</div>
          <button className="link-btn" onClick={onClose}>{Icon.x}</button>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label>Nombre completo <span className="req">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan Pérez" autoFocus />
          </div>
          <div className="form-field">
            <label>Email <span className="req">*</span></label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Ej: juan@gmail.com" />
          </div>
          <div className="form-field">
            <label>Contraseña temporal <span className="req">*</span></label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>
          <div className="form-field">
            <label>Rol</label>
            <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink-1)' }}>
              <option value="operativo">Operador (Lectura y ventas)</option>
              <option value="administrador">Administrador (Control total)</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={submit} disabled={saving || !name.trim() || !email.trim() || !password}>
              {saving ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Detalle de cliente — contacto + máquinas
   ============================================================ */
export function ClientDetail({ id, onBack, onSaved, hideBackBtn }) {
  const [client, setClient] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Usuarios del cliente
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showNewUser, setShowNewUser] = useState(false);

  const { orgs } = useAuth();
  const isSuperAdmin = orgs.some(o => o.id === 'cli_87c461' && o.role === 'administrador');
  const myRoleInThisOrg = orgs.find(o => o.id === id)?.role;
  const canManageUsers = isSuperAdmin || myRoleInThisOrg === 'administrador';

  const loadUsers = async () => {
    try {
      const data = await apiFetch(`/api/clients/${id}/users`);
      setUsers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    let active = true;
    apiFetch(`/api/clients/${id}`)
      .then(data => { if (active) { setClient(data); setForm(data); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    loadUsers();
  }, [id]);

  if (error) return <div style={{ padding: 40, color: 'var(--bad)' }}>Error: {error}</div>;
  if (!client || !form) return <div style={{ padding: 40, color: 'var(--ink-3)' }}>Cargando…</div>;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const dirty = ['name', 'contact_name', 'contact_email', 'contact_phone', 'notes']
    .some(k => (form[k] || '') !== (client[k] || ''));

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name,
          contact_name: form.contact_name,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          notes: form.notes,
        }),
      });
      setClient(form);
      onSaved?.();
    } catch (e) {
      alert('Error al guardar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const createUser = async (payload) => {
    await apiFetch(`/api/clients/${id}/users`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    await loadUsers();
  };

  return (
    <div className="page" data-screen-label="Cliente · Detalle">
      <div className="detail-head">
        <div>
          {!hideBackBtn && (
            <button className="back-link" onClick={onBack}>{Icon.chev} Volver a Clientes</button>
          )}
          <div className="detail-title-row">
            <h1 className="detail-title">{client.name}</h1>
          </div>
          <div className="detail-meta">
            <span className="mono">{client.id}</span>
            <span className="sep">·</span>
            <span>{client.machines?.length ?? 0} máquina(s) vinculada(s)</span>
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>
            {Icon.check} {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Contacto */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Contacto</div>
                <div className="card-sub">Datos del responsable del cliente</div>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-field">
                <label>Nombre</label>
                <input value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Email</label>
                <input type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Teléfono</label>
                <input value={form.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Usuarios vinculados */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="card-head">
              <div>
                <div className="card-title">Usuarios vinculados</div>
                <div className="card-sub">Accesos autorizados a este cliente</div>
              </div>
              {canManageUsers && (
                <button className="btn secondary small" onClick={() => setShowNewUser(true)}>
                  {Icon.plus} Nuevo usuario
                </button>
              )}
            </div>

            <div className="dev-list">
              {loadingUsers ? (
                <div style={{ padding: '18px', color: 'var(--ink-3)', fontSize: 13 }}>Cargando usuarios…</div>
              ) : users.length === 0 ? (
                <div style={{ padding: '18px', color: 'var(--ink-4)', fontSize: 13 }}>Sin usuarios creados para este cliente.</div>
              ) : users.map(u => (
                <div className="dev-row" key={u.id} style={{ padding: '12px 18px' }}>
                  <div className="ico qr">{Icon.user}</div>
                  <div className="name-cell">
                    <span className="n">{u.name}</span>
                    <span className="mono">{u.email}</span>
                  </div>
                  <div>
                    <span className={`spill ${u.role === 'administrador' ? 'ok' : 'normal'}`} style={{ textTransform: 'capitalize' }}>
                      {u.role === 'administrador' ? 'Admin' : 'Operador'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Máquinas vinculadas */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Máquinas vinculadas</div>
              <div className="card-sub">{client.machines?.length ?? 0} máquina(s)</div>
            </div>
          </div>
          <div className="dev-list">
            {(!client.machines || client.machines.length === 0) ? (
              <div style={{ padding: '18px', color: 'var(--ink-4)', fontSize: 13 }}>Sin máquinas vinculadas a este cliente.</div>
            ) : client.machines.map(m => (
              <div className="dev-row" key={m.id}>
                <div className="ico point">{Icon.machine}</div>
                <div className="name-cell">
                  <span className="n">{m.name}</span>
                  <span className="mono">{m.id}</span>
                </div>
                <div style={{ color: 'var(--ink-2)' }}>{m.location || '—'}</div>
                <div></div>
                <div><span className={'spill ' + (m.status === 'active' ? 'ok' : 'warn')}>{m.status}</span></div>
                <div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNewUser && <NewUserModal onClose={() => setShowNewUser(false)} onCreate={createUser} />}
    </div>
  );
}

/* ============================================================
   Entry
   ============================================================ */
export default function Clientes() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [envProd, setEnvProd] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const { orgs } = useAuth();
  const isSuperAdmin = orgs.some(o => o.id === 'cli_87c461' && o.role === 'administrador');

  const load = async () => {
    try {
      const data = await apiFetch('/api/clients');
      setClients(data);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createClient = async (payload) => {
    const { id: newId } = await apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
    await load();
    navigate(`/clientes/${newId}`);
  };

  const crumbs = id
    ? ['Operación', <span key="c" onClick={() => navigate('/clientes')} style={{ cursor: 'pointer' }}>Clientes</span>, id]
    : ['Operación', 'Clientes'];

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar envProd={envProd} onEnvToggle={() => setEnvProd(p => !p)} crumbs={crumbs} />
        {id ? (
          <ClientDetail id={id} onBack={() => navigate('/clientes')} onSaved={load} />
        ) : (
          <div className="page" data-screen-label="Clientes">
            <div className="page-head">
              <div>
                <h1 className="page-title">Clientes</h1>
                <div className="page-subtitle">Gestioná los datos de contacto de cada cliente operador.</div>
              </div>
            </div>
            <ClientList clients={clients} loading={loading} onOpen={(cid) => navigate(`/clientes/${cid}`)} onNew={() => setShowNew(true)} isSuperAdmin={isSuperAdmin} />
          </div>
        )}
        {showNew && <NewClientModal onClose={() => setShowNew(false)} onCreate={createClient} />}
      </div>
    </div>
  );
}

import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { hashPassword } from '../services/auth.js';

const router = Router();

function genClientId() {
  return 'cli_' + crypto.randomBytes(3).toString('hex');
}

// Check if user is Super Admin (admin role of Tecnovend cli_87c461)
async function isSuperAdminUser(userId) {
  const check = await db.prepare(`
    SELECT 1 FROM memberships 
    WHERE user_id = ? AND client_id = 'cli_87c461' AND role = 'administrador'
  `).get(userId);
  return !!check;
}

// Listado de organizaciones. Si hay sesión, solo las del usuario (con su rol) o todas si es Super Admin.
router.get('/', requireAuth, async (req, res) => {
  const isSuper = await isSuperAdminUser(req.user.id);
  let clients;
  
  if (isSuper) {
    // Super admins see all clients
    clients = await db.prepare(`
      SELECT c.*, 
        COALESCE((SELECT role FROM memberships m WHERE m.client_id = c.id AND m.user_id = ?), 'administrador') AS my_role,
        (SELECT COUNT(*) FROM machines mm WHERE mm.client_id = c.id) AS machine_count
      FROM clients c
      ORDER BY c.created_at DESC
    `).all(req.user.id);
  } else {
    // Normal users only see their own clients
    clients = await db.prepare(`
      SELECT c.*, m.role AS my_role,
        (SELECT COUNT(*) FROM machines mm WHERE mm.client_id = c.id) AS machine_count
      FROM clients c
      JOIN memberships m ON m.client_id = c.id
      WHERE m.user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);
  }
  res.json(clients);
});

// Crear cliente (SOLO Super Admin)
router.post('/', requireAuth, async (req, res) => {
  const isSuper = await isSuperAdminUser(req.user.id);
  if (!isSuper) {
    return res.status(403).json({ error: 'No tenés permisos de Super Admin para crear clientes' });
  }

  const {
    name, contact_name, contact_email, contact_phone, notes,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name es requerido' });

  const id = genClientId();
  await db.prepare(`
    INSERT INTO clients
      (id, name, contact_name, contact_email, contact_phone, notes)
    VALUES (?,?,?,?,?,?)
  `).run(
    id, name, contact_name ?? null, contact_email ?? null, contact_phone ?? null, notes ?? null,
  );
  
  // El creador (super admin) queda como administrador de la nueva organización.
  await db.prepare('INSERT INTO memberships (id, user_id, client_id, role) VALUES (?,?,?,?)')
    .run('mem_' + crypto.randomBytes(3).toString('hex'), req.user.id, id, 'administrador');

  res.status(201).json({ id });
});

// Detalle de cliente + sus máquinas
router.get('/:id', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  const isSuper = await isSuperAdminUser(req.user.id);

  if (!isSuper) {
    const isMember = await db.prepare(`
      SELECT 1 FROM memberships WHERE user_id = ? AND client_id = ?
    `).get(req.user.id, clientId);
    if (!isMember) {
      return res.status(403).json({ error: 'No tenés acceso a este cliente' });
    }
  }

  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  const machines = await db.prepare(
    'SELECT id, name, location, status, last_seen_at FROM machines WHERE client_id = ? ORDER BY created_at DESC'
  ).all(clientId);
  res.json({ ...client, machines });
});

// Actualizar cliente (datos de contacto, notas, etc.)
router.put('/:id', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  const isSuper = await isSuperAdminUser(req.user.id);

  if (!isSuper) {
    const userRole = await db.prepare(`
      SELECT role FROM memberships WHERE user_id = ? AND client_id = ?
    `).get(req.user.id, clientId);
    if (!userRole || userRole.role !== 'administrador') {
      return res.status(403).json({ error: 'No tenés permisos de administrador en este cliente' });
    }
  }

  const {
    name, contact_name, contact_email, contact_phone, notes,
  } = req.body || {};
  const client = await db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  await db.prepare(`
    UPDATE clients SET
      name          = COALESCE(?, name),
      contact_name  = COALESCE(?, contact_name),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      notes         = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    name ?? null, contact_name ?? null, contact_email ?? null, contact_phone ?? null, notes ?? null,
    clientId,
  );
  res.json({ ok: true });
});

// GET /api/clients/:id/users (obtener usuarios de un cliente)
router.get('/:id/users', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  const isSuper = await isSuperAdminUser(req.user.id);

  if (!isSuper) {
    const isMember = await db.prepare(`
      SELECT 1 FROM memberships WHERE user_id = ? AND client_id = ?
    `).get(req.user.id, clientId);
    if (!isMember) {
      return res.status(403).json({ error: 'No tenés acceso a este cliente' });
    }
  }

  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, m.role, u.created_at
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE m.client_id = ?
    ORDER BY u.created_at DESC
  `).all(clientId);

  res.json(users);
});

// POST /api/clients/:id/users (crear o agregar usuario a un cliente)
router.post('/:id/users', requireAuth, async (req, res) => {
  const clientId = req.params.id;
  const isSuper = await isSuperAdminUser(req.user.id);

  if (!isSuper) {
    const userRole = await db.prepare(`
      SELECT role FROM memberships WHERE user_id = ? AND client_id = ?
    `).get(req.user.id, clientId);
    if (!userRole || userRole.role !== 'administrador') {
      return res.status(403).json({ error: 'No tenés permisos para agregar usuarios a este cliente' });
    }
  }

  const { name, email, password, role } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'name, email y password son requeridos' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  // Buscar si el usuario ya existe en la base de datos
  let user = await db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  let userId;

  if (user) {
    userId = user.id;
    // Validar si ya es miembro de esta organización
    const existingMem = await db.prepare('SELECT id FROM memberships WHERE user_id = ? AND client_id = ?').get(userId, clientId);
    if (existingMem) {
      return res.status(400).json({ error: 'El usuario ya pertenece a este cliente' });
    }
  } else {
    // Crear el usuario de cero
    userId = 'usr_' + crypto.randomBytes(3).toString('hex');
    await db.prepare('INSERT INTO users (id, name, email, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .run(userId, name.trim(), cleanEmail, hashPassword(password));
  }

  // Vincular con la membresía
  const memId = 'mem_' + crypto.randomBytes(3).toString('hex');
  await db.prepare('INSERT INTO memberships (id, user_id, client_id, role) VALUES (?, ?, ?, ?)')
    .run(memId, userId, clientId, role === 'operativo' ? 'operativo' : 'administrador');

  res.status(201).json({ id: userId, email: cleanEmail });
});

export default router;

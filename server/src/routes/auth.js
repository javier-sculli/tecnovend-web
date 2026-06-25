import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { verifyPassword, hashPassword, signToken } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/setup — siembra inicial vía API. SOLO funciona si todavía no
// hay usuarios (después de la primera vez responde 403 para siempre).
// Body: { org_name, users: [{ name, email, password, role }] }
// No borra ni pisa nada: solo inserta org/usuarios/membresías y asigna a la org
// las máquinas que no tienen ninguna (client_id IS NULL).
router.post('/setup', (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0) return res.status(403).json({ error: 'Ya inicializado' });

  const { org_name, users } = req.body || {};
  if (!org_name || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: 'org_name y users[] requeridos' });
  }

  const gid = (p) => p + crypto.randomBytes(3).toString('hex');
  let org = db.prepare('SELECT id FROM clients WHERE name = ?').get(org_name);
  if (!org) {
    const id = gid('cli_');
    db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, org_name);
    org = { id };
  }

  const created = [];
  for (const u of users) {
    if (!u?.email || !u?.password) continue;
    const email = String(u.email).trim().toLowerCase();
    const id = gid('usr_');
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)')
      .run(id, u.name || email, email, hashPassword(u.password));
    db.prepare('INSERT INTO memberships (id, user_id, client_id, role) VALUES (?,?,?,?)')
      .run(gid('mem_'), id, org.id, u.role === 'operativo' ? 'operativo' : 'administrador');
    created.push(email);
  }

  const machines = db.prepare('UPDATE machines SET client_id = ? WHERE client_id IS NULL').run(org.id);
  res.status(201).json({ ok: true, org_id: org.id, users_created: created, machines_assigned: machines.changes });
});

// Organizaciones (clients) a las que pertenece el usuario, con su rol.
function orgsForUser(userId) {
  return db.prepare(`
    SELECT c.id, c.name, m.role
    FROM memberships m
    JOIN clients c ON c.id = m.client_id
    WHERE m.user_id = ?
    ORDER BY c.name
  `).all(userId);
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, must_change_password: !!u.must_change_password };
}

// POST /api/auth/login { email, password } → { token, user, orgs }
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  const token = signToken({ sub: user.id });
  res.json({ token, user: publicUser(user), orgs: orgsForUser(user.id) });
});

// GET /api/auth/me → { user, orgs }  (requiere sesión)
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user), orgs: orgsForUser(user.id) });
});

// POST /api/auth/logout → no-op (JWT stateless; el cliente descarta el token)
router.post('/logout', (req, res) => res.json({ ok: true }));

// POST /api/auth/change-password { current_password, new_password }
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(new_password), user.id);
  res.json({ ok: true });
});

export default router;

import db from '../db/schema.js';
import { verifyToken } from '../services/auth.js';

// Revisa si un usuario es Super Admin (administrador de la org Tecnovend)
export async function isSuperAdminUser(userId) {
  if (!userId) return false;
  const check = await db.prepare(`
    SELECT 1 FROM memberships m
    JOIN clients c ON c.id = m.client_id
    WHERE m.user_id = ? AND (c.name = 'Tecnovend' OR c.id = 'cli_87c461') AND m.role = 'administrador'
  `).get(userId);
  return !!check;
}

// Exige un JWT válido. Deja en req.user = { id, name, email }.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload?.sub) return res.status(401).json({ error: 'No autenticado' });

  const user = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'Sesión inválida' });
  req.user = user;
  next();
}

// Devuelve el rol del usuario en una organización, o null si no es miembro.
// Si el usuario es Super Admin, tiene acceso de administrador a cualquier organización.
export async function roleInOrg(userId, clientId) {
  const m = await db.prepare('SELECT role FROM memberships WHERE user_id = ? AND client_id = ?').get(userId, clientId);
  if (m?.role) return m.role;
  const isSuper = await isSuperAdminUser(userId);
  if (isSuper) return 'administrador';
  return null;
}

// Exige que el usuario sea miembro de la organización indicada (header
// `x-org-id` o param/clientId que arme el caller). Deja req.orgRole.
export function requireOrgMember(getClientId) {
  return async (req, res, next) => {
    const clientId = getClientId(req);
    if (!clientId) return res.status(400).json({ error: 'Falta organización' });
    const role = await roleInOrg(req.user.id, clientId);
    if (!role) return res.status(403).json({ error: 'No pertenecés a esta organización' });
    req.orgRole = role;
    req.orgId = clientId;
    next();
  };
}

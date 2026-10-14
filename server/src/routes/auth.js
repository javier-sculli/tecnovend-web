import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/schema.js';
import { verifyPassword, hashPassword, signToken } from '../services/auth.js';
import { requireAuth, isSuperAdminUser } from '../middleware/auth.js';
import { sendMail } from '../services/mailer.js';

const router = Router();

// POST /api/auth/setup — siembra inicial vía API. SOLO funciona si todavía no
// hay usuarios (después de la primera vez responde 403 para siempre).
// Body: { org_name, users: [{ name, email, password, role }] }
// No borra ni pisa nada: solo inserta org/usuarios/membresías y asigna a la org
// las máquinas que no tienen ninguna (client_id IS NULL).
router.post('/setup', async (req, res) => {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM users').get();
  const existing = row ? Number(row.c) : 0;
  if (existing > 0) return res.status(403).json({ error: 'Ya inicializado' });

  const { org_name, users } = req.body || {};
  if (!org_name || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: 'org_name y users[] requeridos' });
  }

  const gid = (p) => p + crypto.randomBytes(3).toString('hex');
  let org = await db.prepare('SELECT id FROM clients WHERE name = ?').get(org_name);
  if (!org) {
    const id = gid('cli_');
    await db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)').run(id, org_name);
    org = { id };
  }

  const created = [];
  for (const u of users) {
    if (!u?.email || !u?.password) continue;
    const email = String(u.email).trim().toLowerCase();
    const id = gid('usr_');
    await db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)')
      .run(id, u.name || email, email, hashPassword(u.password));
    await db.prepare('INSERT INTO memberships (id, user_id, client_id, role) VALUES (?,?,?,?)')
      .run(gid('mem_'), id, org.id, u.role === 'operativo' ? 'operativo' : 'administrador');
    created.push(email);
  }

  const machines = await db.prepare('UPDATE machines SET client_id = ? WHERE client_id IS NULL').run(org.id);
  res.status(201).json({ ok: true, org_id: org.id, users_created: created, machines_assigned: machines.changes });
});

// Organizaciones (clients) a las que pertenece el usuario, con su rol.
// Si el usuario es Super Admin, puede ver e ingresar a TODAS las organizaciones.
async function orgsForUser(userId) {
  const isSuper = await isSuperAdminUser(userId);
  if (isSuper) {
    return await db.prepare(`
      SELECT c.id, c.name, COALESCE(c.employee_discounts_enabled, 0) AS employee_discounts_enabled, COALESCE(m.role, 'administrador') AS role
      FROM clients c
      LEFT JOIN memberships m ON m.client_id = c.id AND m.user_id = ?
      ORDER BY c.name
    `).all(userId);
  }
  return await db.prepare(`
    SELECT c.id, c.name, COALESCE(c.employee_discounts_enabled, 0) AS employee_discounts_enabled, m.role
    FROM memberships m
    JOIN clients c ON c.id = m.client_id
    WHERE m.user_id = ?
    ORDER BY c.name
  `).all(userId);
}

async function publicUser(u) {
  const isSuper = await isSuperAdminUser(u.id);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    must_change_password: !!u.must_change_password,
    is_super_admin: isSuper,
  };
}

// POST /api/auth/login { email, password } → { token, user, orgs }
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  const token = signToken({ sub: user.id });
  const orgs = await orgsForUser(user.id);
  res.json({ token, user: await publicUser(user), orgs });
});

// GET /api/auth/me → { user, orgs }  (requiere sesión)
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const orgs = await orgsForUser(user.id);
  res.json({ user: await publicUser(user), orgs });
});

// POST /api/auth/logout → no-op (JWT stateless; el cliente descarta el token)
router.post('/logout', (req, res) => res.json({ ok: true }));

// POST /api/auth/change-password { current_password, new_password }
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(new_password), user.id);
  res.json({ ok: true });
});

function getAppBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    try {
      const u = new URL(origin);
      return u.origin;
    } catch {}
  }
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host) return `${proto}://${host}`;
  return 'https://www.vendpoint.com.ar';
}

function buildResetPasswordMail({ userName, userEmail, resetUrl }) {
  const subject = 'Recuperar contraseña — VendPoint';

  const text = [
    `Hola ${userName || 'usuario'},`,
    '',
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta en VendPoint (${userEmail}).`,
    '',
    `Para crear una nueva contraseña, ingresá al siguiente enlace (válido por 1 hora):`,
    resetUrl,
    '',
    `Si no realizaste esta solicitud, podés ignorar este correo de forma segura. Tu contraseña no cambiará hasta que ingreses al enlace y crees una nueva.`,
    '',
    '— VendPoint',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #ffffff; color: #18181b; border: 1px solid #ebebe7; border-radius: 12px;">
      <div style="margin-bottom: 24px;">
        <span style="display: inline-block; width: 28px; height: 28px; border-radius: 8px; background: radial-gradient(120% 120% at 0% 0%, #ed7a3a 0%, #c2410c 55%, #7c2d12 100%); vertical-align: middle; margin-right: 10px;"></span>
        <strong style="font-size: 18px; vertical-align: middle; color: #18181b;">VendPoint</strong>
      </div>
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 14px; color: #18181b;">Recuperación de contraseña</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 20px;">
        Hola <strong>${userName || 'usuario'}</strong>,<br>
        Recibimos una solicitud para restablecer la contraseña de tu cuenta asociada a <strong>${userEmail}</strong>.
      </p>
      <div style="margin: 28px 0;">
        <a href="${resetUrl}" style="background: #c2410c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500; display: inline-block;">
          Restablecer contraseña
        </a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #71717a; margin: 0 0 16px;">
        O podés copiar y pegar este enlace en tu navegador:<br>
        <a href="${resetUrl}" style="color: #c2410c; word-break: break-all;">${resetUrl}</a>
      </p>
      <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #ebebe7; font-size: 12px; color: #a1a1aa; line-height: 1.5;">
        <p style="margin: 0 0 8px;">Este enlace tiene una validez de <strong>1 hora</strong> y solo puede ser utilizado una vez.</p>
        <p style="margin: 0;">Si no solicitaste este cambio, podés ignorar este correo de forma segura. Tu contraseña no cambiará.</p>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

// POST /api/auth/forgot-password { email }
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Ingresá tu correo electrónico' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const user = await db.prepare('SELECT id, name, email FROM users WHERE LOWER(email) = ?').get(cleanEmail);

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const resetId = 'rst_' + crypto.randomBytes(4).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    // Invalidar solicitudes anteriores pendientes
    await db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').run(user.id);

    // Guardar nuevo registro
    await db.prepare('INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(resetId, user.id, tokenHash, expiresAt);

    const baseUrl = getAppBaseUrl(req);
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    const { subject, html, text } = buildResetPasswordMail({
      userName: user.name,
      userEmail: user.email,
      resetUrl,
    });

    const mailRes = await sendMail({
      to: user.email,
      subject,
      html,
      text,
    });

    if (mailRes.ok) {
      console.log(`[auth] Mail de recupero enviado a ${user.email}`);
    } else {
      console.warn(`[auth] Mail de recupero NO enviado a ${user.email} (${mailRes.skipped || mailRes.error || mailRes.status}). Enlace de prueba: ${resetUrl}`);
    }
  } else {
    console.log(`[auth] Recuperación solicitada para email inexistente: ${cleanEmail}`);
  }

  // Respuesta homogénea para no facilitar enumeración de cuentas
  res.json({
    ok: true,
    message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
  });
});

// GET /api/auth/verify-reset-token?token=...
router.get('/verify-reset-token', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ valid: false, error: 'Token no provisto' });

  const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
  const record = await db.prepare(`
    SELECT pr.id, pr.expires_at, pr.used_at, u.email
    FROM password_resets pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.token_hash = ?
  `).get(tokenHash);

  if (!record || record.used_at) {
    return res.json({ valid: false, error: 'El enlace de recuperación es inválido o ya fue utilizado.' });
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return res.json({ valid: false, error: 'El enlace de recuperación ha expirado.' });
  }

  res.json({ valid: true, email: record.email });
});

// POST /api/auth/reset-password { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Token de restablecimiento requerido' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
  const record = await db.prepare(`
    SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email
    FROM password_resets pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.token_hash = ?
  `).get(tokenHash);

  if (!record || record.used_at) {
    return res.status(400).json({ error: 'El enlace de recuperación es inválido o ya fue utilizado.' });
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'El enlace de recuperación ha expirado. Por favor, solicitá uno nuevo.' });
  }

  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(password), record.user_id);

  await db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(record.id);

  console.log(`[auth] Contraseña actualizada exitosamente para usuario ${record.email}`);
  res.json({ ok: true, message: 'Tu contraseña ha sido actualizada con éxito.' });
});

export default router;

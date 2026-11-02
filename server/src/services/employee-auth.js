import crypto from 'crypto';
import db from '../db/schema.js';
import { sendMail } from './mailer.js';

export function hashToken(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

export function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Busca un empleado activo por email en la organización dada.
 */
export async function findActiveEmployeeByEmail(clientId, email) {
  if (!clientId || !email) return null;
  const cleanEmail = String(email).trim().toLowerCase();

  return await db.prepare(`
    SELECT e.id, e.client_id, e.email, e.name, e.dni, e.discount_pct, e.status,
           c.name as client_name, c.default_discount_pct, c.employee_discounts_enabled
    FROM client_employees e
    JOIN clients c ON c.id = e.client_id
    WHERE e.client_id = ? AND LOWER(e.email) = ? AND e.status = 'active'
  `).get(clientId, cleanEmail);
}

/**
 * Genera y envía un código OTP de 4 dígitos para ingresar al portal de empleados.
 */
export async function createAndSendOtp(clientId, email) {
  const emp = await findActiveEmployeeByEmail(clientId, email);
  if (!emp) {
    const err = new Error('El correo ingresado no figura en la nómina de empleados de esta empresa.');
    err.status = 404;
    throw err;
  }

  if (!emp.employee_discounts_enabled) {
    const err = new Error('El beneficio de empleados no está habilitado actualmente para esta empresa.');
    err.status = 403;
    throw err;
  }

  const cleanEmail = String(email).trim().toLowerCase();

  // Rate-limit: máximo 3 códigos en los últimos 15 minutos
  const recentCountRow = await db.prepare(`
    SELECT COUNT(*) as c 
    FROM employee_auth_otps
    WHERE client_id = ? AND LOWER(email) = ? AND created_at > datetime('now', '-15 minutes')
  `).get(clientId, cleanEmail);

  if (Number(recentCountRow?.c || 0) >= 3) {
    const err = new Error('Demasiados códigos solicitados. Por favor esperá unos minutos antes de reintentar.');
    err.status = 429;
    throw err;
  }

  // Generar código aleatorio de 4 dígitos
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const codeHash = hashToken(code);
  const otpId = genId('otp');

  await db.prepare(`
    INSERT INTO employee_auth_otps (id, client_id, employee_id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))
  `).run(otpId, clientId, emp.id, cleanEmail, codeHash);

  // Enviar correo vía Resend
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 12px; background: #ffffff;">
      <div style="margin-bottom: 20px;">
        <span style="display: inline-block; padding: 4px 10px; background: #eff6ff; color: #2563eb; border-radius: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">VENDPOINT · BENEFICIO EMPLEADOS</span>
      </div>
      <h2 style="color: #09090b; margin: 0 0 12px 0; font-size: 20px; font-weight: 700;">Tu código de acceso</h2>
      <p style="color: #52525b; font-size: 14px; line-height: 1.5; margin: 0 0 20px 0;">
        Hola ${emp.name ? emp.name.split(' ')[0] : 'colega'}, usá el siguiente código de 4 dígitos en tu celular para activar tu beneficio en <b>${emp.client_name || 'la máquina'}</b>:
      </p>
      <div style="background: #f4f4f5; border: 1px dashed #d4d4d8; padding: 18px; border-radius: 8px; text-align: center; margin: 0 0 20px 0;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #18181b; font-family: monospace;">${code}</span>
      </div>
      <p style="color: #71717a; font-size: 12px; line-height: 1.4; margin: 0 0 8px 0;">
        ⏱ Válido por 10 minutos. Una vez que ingreses, tu sesión quedará guardada en tu teléfono para que no tengas que pedir otro código cada vez.
      </p>
      <p style="color: #a1a1aa; font-size: 11px; margin: 16px 0 0 0; border-top: 1px solid #f4f4f5; padding-top: 12px;">
        Si vos no solicitaste este código, podés ignorar este correo de forma segura.
      </p>
    </div>
  `;

  const mailResult = await sendMail({
    to: cleanEmail,
    subject: `Tu código de acceso VendPoint: ${code}`,
    html,
    text: `Tu código de acceso a VendPoint es: ${code}. Válido por 10 minutos.`
  });

  return { ok: true, mailSent: mailResult.ok };
}

/**
 * Valida el código OTP y crea una sesión persistente de 180 días.
 */
export async function verifyOtpAndCreateSession(clientId, email, code, userAgent = '') {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();

  const emp = await findActiveEmployeeByEmail(clientId, cleanEmail);
  if (!emp) {
    const err = new Error('Empleado no encontrado o inactivo.');
    err.status = 404;
    throw err;
  }

  // Buscar el OTP activo más reciente
  const otp = await db.prepare(`
    SELECT * FROM employee_auth_otps
    WHERE client_id = ? AND employee_id = ? AND used_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(clientId, emp.id);

  if (!otp) {
    const err = new Error('El código ingresado expiró o no es válido. Solicitá uno nuevo.');
    err.status = 400;
    throw err;
  }

  if (otp.attempts >= 5) {
    const err = new Error('Demasiados intentos fallidos. Solicitá un código nuevo.');
    err.status = 400;
    throw err;
  }

  const inputHash = hashToken(cleanCode);
  if (inputHash !== otp.code_hash) {
    await db.prepare(`UPDATE employee_auth_otps SET attempts = attempts + 1 WHERE id = ?`).run(otp.id);
    const err = new Error('El código ingresado es incorrecto.');
    err.status = 400;
    throw err;
  }

  // Marcar como usado
  await db.prepare(`UPDATE employee_auth_otps SET used_at = datetime('now') WHERE id = ?`).run(otp.id);

  // Generar token de sesión criptográfico (32 bytes = 64 hex chars)
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const sessionId = genId('esess');

  await db.prepare(`
    INSERT INTO employee_sessions (id, client_id, employee_id, token_hash, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+180 days'))
  `).run(sessionId, clientId, emp.id, tokenHash, String(userAgent || '').slice(0, 255));

  const effectiveDiscountPct = Number(emp.discount_pct) > 0 
    ? Number(emp.discount_pct) 
    : (Number(emp.default_discount_pct) || 20);

  return {
    token,
    employee: {
      id: emp.id,
      name: emp.name || cleanEmail.split('@')[0],
      email: emp.email,
      dni: emp.dni,
      discountPct: effectiveDiscountPct,
      clientName: emp.client_name,
    }
  };
}

/**
 * Valida un token de sesión de empleado y verifica que siga activo.
 */
export async function getEmployeeBySessionToken(token, expectedClientId = null) {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const row = await db.prepare(`
    SELECT s.id as session_id, s.client_id, s.employee_id, s.expires_at,
           e.name, e.email, e.dni, e.discount_pct, e.status as employee_status,
           c.name as client_name, c.default_discount_pct, c.employee_discounts_enabled
    FROM employee_sessions s
    JOIN client_employees e ON e.id = s.employee_id
    JOIN clients c ON c.id = s.client_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
  `).get(tokenHash);

  if (!row) return null;
  if (row.employee_status !== 'active') return null;
  if (!row.employee_discounts_enabled) return null;
  if (expectedClientId && row.client_id !== expectedClientId) return null;

  // Actualizar last_used_at en segundo plano
  db.prepare(`UPDATE employee_sessions SET last_used_at = datetime('now') WHERE id = ?`)
    .run(row.session_id)
    .catch(() => {});

  const effectiveDiscountPct = Number(row.discount_pct) > 0 
    ? Number(row.discount_pct) 
    : (Number(row.default_discount_pct) || 20);

  return {
    sessionId: row.session_id,
    clientId: row.client_id,
    clientName: row.client_name,
    employeeId: row.employee_id,
    name: row.name || row.email.split('@')[0],
    email: row.email,
    dni: row.dni,
    discountPct: effectiveDiscountPct,
  };
}

/**
 * Cierra la sesión del empleado.
 */
export async function revokeEmployeeSession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  await db.prepare(`DELETE FROM employee_sessions WHERE token_hash = ?`).run(tokenHash);
}

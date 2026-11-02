import { getEmployeeBySessionToken } from '../services/employee-auth.js';

function extractToken(req) {
  // 1. Desde cookie
  if (req.cookies && req.cookies.emp_session) {
    return req.cookies.emp_session;
  }
  // También parsear header Cookie directamente por si cookie-parser no está activo
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    const match = rawCookie.match(/(?:^|;\s*)emp_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  // 2. Desde Authorization Bearer
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // 3. Desde header personalizado
  if (req.headers['x-employee-token']) {
    return req.headers['x-employee-token'];
  }

  return null;
}

export async function requireEmployeeAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No autenticado. Por favor ingresá tu email para continuar.' });
    }

    const employee = await getEmployeeBySessionToken(token);
    if (!employee) {
      return res.status(401).json({ error: 'Tu sesión expiró o tu usuario ya no está activo.' });
    }

    req.employee = employee;
    next();
  } catch (err) {
    console.error('[employee-auth-middleware]', err.message);
    res.status(500).json({ error: 'Error validando sesión' });
  }
}

export async function optionalEmployeeAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const employee = await getEmployeeBySessionToken(token);
      if (employee) {
        req.employee = employee;
      }
    }
  } catch (_) {}
  next();
}

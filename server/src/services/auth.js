import crypto from 'crypto';

// ── Password hashing (scrypt nativo) ─────────────────────────────────────────
// Formato guardado: scrypt$<saltHex>$<hashHex>
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(plain), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ── JWT (HS256 mínimo, sin dependencias) ─────────────────────────────────────
const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64urlJson = (obj) => b64url(JSON.stringify(obj));

function sign(data) {
  return b64url(crypto.createHmac('sha256', SECRET).update(data).digest());
}

export function signToken(payload) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TTL_SECONDS });
  const data = `${header}.${body}`;
  return `${data}.${sign(data)}`;
}

// Devuelve el payload si el token es válido y no expiró; si no, null.
export function verifyToken(token) {
  if (!token || token.split('.').length !== 3) return null;
  const [header, body, sig] = token.split('.');
  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

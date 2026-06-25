// Cliente HTTP central. Inyecta el token de sesión y la organización
// seleccionada en cada request, y maneja el 401 global (sesión vencida).

// La web la sirve el mismo Express de la API (servicio unificado), así que en
// producción la API es siempre el mismo origen. VITE_API_URL solo se usa en
// dev local para apuntar a prod.
export const API_BASE = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'tv_token';
const ORG_KEY = 'tv_org';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
export const getOrgId = () => localStorage.getItem(ORG_KEY);
export const setOrgId = (id) => id ? localStorage.setItem(ORG_KEY, id) : localStorage.removeItem(ORG_KEY);

// Se dispara en un 401: el AuthProvider lo escucha para desloguear.
function onUnauthorized() {
  setToken(null);
  window.dispatchEvent(new Event('tv-unauthorized'));
}

export async function apiFetch(path, opts = {}) {
  const token = getToken();
  const orgId = getOrgId();
  const res = await fetch(API_BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'x-org-id': orgId } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    onUnauthorized();
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'No autenticado');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

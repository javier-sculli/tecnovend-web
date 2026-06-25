import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, setToken, getToken, getOrgId, setOrgId } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrg] = useState(getOrgId());
  const [loading, setLoading] = useState(true);

  // Elige una organización por defecto si no hay una válida seleccionada.
  const ensureOrg = useCallback((list, current) => {
    const valid = current && list.some(o => o.id === current);
    const next = valid ? current : (list[0]?.id || null);
    setOrg(next);
    setOrgId(next);
    return next;
  }, []);

  const hydrate = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const { user, orgs } = await apiFetch('/api/auth/me');
      setUser(user);
      setOrgs(orgs);
      ensureOrg(orgs, getOrgId());
    } catch {
      setUser(null); setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [ensureOrg]);

  useEffect(() => { hydrate(); }, [hydrate]);

  // 401 global → cerrar sesión
  useEffect(() => {
    const onUnauth = () => { setUser(null); setOrgs([]); };
    window.addEventListener('tv-unauthorized', onUnauth);
    return () => window.removeEventListener('tv-unauthorized', onUnauth);
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user, orgs } = await apiFetch('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    setToken(token);
    setUser(user);
    setOrgs(orgs);
    ensureOrg(orgs, getOrgId());
    return user;
  }, [ensureOrg]);

  const logout = useCallback(async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setToken(null);
    setUser(null);
    setOrgs([]);
  }, []);

  const selectOrg = useCallback((id) => { setOrg(id); setOrgId(id); }, []);

  const currentOrg = orgs.find(o => o.id === orgId) || null;

  return (
    <AuthCtx.Provider value={{ user, orgs, orgId, currentOrg, loading, login, logout, selectOrg }}>
      {children}
    </AuthCtx.Provider>
  );
}

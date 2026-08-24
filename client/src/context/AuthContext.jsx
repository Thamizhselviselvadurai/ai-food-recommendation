import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;

    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setPreferences(data.preferences);
      })
      // An expired token is cleared by the api layer; nothing to show the user.
      .catch(() => setToken(null))
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, []);

  const handleAuthSuccess = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
    return api.preferences().then((p) => setPreferences(p.preferences)).catch(() => {});
  }, []);

  const login = useCallback(
    async (credentials) => handleAuthSuccess(await api.login(credentials)),
    [handleAuthSuccess]
  );

  const register = useCallback(
    async (details) => handleAuthSuccess(await api.register(details)),
    [handleAuthSuccess]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setPreferences(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    const data = await api.me();
    setUser(data.user);
    setPreferences(data.preferences);
  }, []);

  const value = useMemo(
    () => ({ user, preferences, setPreferences, loading, login, register, logout, refreshUser, isAuthenticated: Boolean(user) }),
    [user, preferences, loading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};

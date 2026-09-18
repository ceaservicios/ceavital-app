import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  useEffect(() => {
    let cancelado = false;
    api
      .get('/auth/me')
      .then((data) => {
        if (!cancelado) setUsuario(data);
      })
      .catch(() => {
        if (!cancelado) setUsuario(null);
      })
      .finally(() => {
        if (!cancelado) setCargandoSesion(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUsuario(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (usuarioLogin, password) => {
    const data = await api.post('/auth/login', { usuario: usuarioLogin, password });
    setUsuario({
      usuarioId: data.usuario.id,
      usuario: data.usuario.usuario,
      nombre: data.usuario.nombre,
      rol: data.usuario.rol,
    });
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUsuario(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, cargandoSesion, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setCsrfSuperadmin, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  // Módulos activos según el plan de la instalación (GET /modulos, público).
  // null = todavía cargando; si el pedido falla se muestra solo el núcleo.
  const [modulos, setModulos] = useState(null);

  // Si el superadmin cambia el plan con la app abierta, los módulos se muestran u ocultan
  // solos (pedido del usuario 2026-10-11): se vuelven a pedir al cambiar de pantalla, al
  // volver a la pestaña del navegador y cada minuto. Un fallo en una de esas consultas
  // conserva la lista que ya había (solo la primera carga cae al núcleo).
  const { pathname } = useLocation();
  const cargarModulos = useCallback(async () => {
    try {
      const data = await api.get('/modulos');
      setModulos((anteriores) =>
        anteriores && anteriores.join() === data.modulos.join() ? anteriores : data.modulos
      );
    } catch {
      setModulos((anteriores) => anteriores ?? ['nucleo']);
    }
  }, []);

  useEffect(() => {
    cargarModulos();
  }, [pathname, cargarModulos]);

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargarModulos();
    };
    const intervalo = setInterval(alVolver, 60_000);
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargarModulos]);

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

  const guardarUsuario = useCallback((data) => {
    setUsuario({
      usuarioId: data.usuario.id,
      usuario: data.usuario.usuario,
      nombre: data.usuario.nombre,
      rol: data.usuario.rol,
    });
    return data;
  }, []);

  const login = useCallback(
    async (usuarioLogin, password) => {
      const data = await api.post('/auth/login', { usuario: usuarioLogin, password });
      // El superadmin de CEA entra por el mismo login: no es un usuario del negocio, su
      // sesión es aparte (cookie propia) y la pantalla lo lleva a su panel.
      if (data.tipo === 'superadmin') {
        setCsrfSuperadmin(data.csrf_token);
        return data;
      }
      // Falta el código que le llegó por mail (email sin verificar o 2FA): la sesión
      // se abre recién en confirmarCodigo.
      if (data.requiere_codigo) return data;
      return guardarUsuario(data);
    },
    [guardarUsuario]
  );

  const confirmarCodigo = useCallback(
    async (desafio, codigo) => guardarUsuario(await api.post('/auth/codigo', { desafio, codigo })),
    [guardarUsuario]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUsuario(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        cargandoSesion: cargandoSesion || modulos === null,
        modulos: modulos ?? [],
        moduloActivo: (modulo) => Boolean(modulos?.includes(modulo)),
        login,
        confirmarCodigo,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

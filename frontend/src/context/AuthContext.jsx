import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setCsrfSuperadmin, setPendienteHandler, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  // Módulos activos según el plan de la instalación (GET /modulos, público).
  // null = todavía cargando; si el pedido falla se muestra solo el núcleo.
  const [modulos, setModulos] = useState(null);
  // EST-01 §3: si el ingreso cerró una sesión abierta en otro dispositivo, se le avisa acá.
  const [avisoIngreso, setAvisoIngreso] = useState(null);

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

  // Stock de los productos con pack en unidades o en packs (lo elige el Admin en Configuración,
  // 2026-10-28). Se vuelve a pedir al cambiar de pantalla, así un cambio les llega a los demás
  // usuarios sin recargar. Si el pedido falla, queda lo que había.
  const [stockEnPacks, setStockEnPacks] = useState(false);
  const sesionLista = Boolean(usuario && !usuario.pendiente);
  useEffect(() => {
    if (!sesionLista) return;
    api
      .get('/negocio/stock-en')
      .then((data) => setStockEnPacks(data.stock_en === 'packs'))
      .catch(() => {});
  }, [sesionLista, pathname]);

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

  const descartarAvisoIngreso = useCallback(() => setAvisoIngreso(null), []);

  const actualizarPendiente = useCallback((pendiente) => {
    setUsuario((actual) => (actual ? { ...actual, pendiente: pendiente ?? null } : actual));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUsuario(null));
    setPendienteHandler(actualizarPendiente);
    return () => {
      setUnauthorizedHandler(null);
      setPendienteHandler(null);
    };
  }, [actualizarPendiente]);

  const guardarUsuario = useCallback((data) => {
    setUsuario({
      usuarioId: data.usuario.id,
      usuario: data.usuario.usuario,
      nombre: data.usuario.nombre,
      rol: data.usuario.rol,
      pendiente: data.usuario.pendiente ?? null,
    });
    setAvisoIngreso(data.expulsoSesionAnterior ? 'Tenías una sesión abierta en otro dispositivo: se cerró al entrar acá.' : null);
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
      // Falta el segundo paso (código de la app o del mail): la sesión se abre recién en confirmarCodigo.
      if (data.requiere_codigo) return data;
      return guardarUsuario(data);
    },
    [guardarUsuario]
  );

  // El código también puede ser del superadmin (el ingreso es uno solo): su sesión es aparte.
  const confirmarCodigo = useCallback(
    async (desafio, codigo) => {
      const data = await api.post('/auth/codigo', { desafio, codigo });
      if (data.tipo === 'superadmin') {
        setCsrfSuperadmin(data.csrf_token);
        return data;
      }
      return guardarUsuario(data);
    },
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
        stockEnPacks,
        setStockEnPacks,
        login,
        confirmarCodigo,
        logout,
        actualizarPendiente,
        avisoIngreso,
        descartarAvisoIngreso,
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

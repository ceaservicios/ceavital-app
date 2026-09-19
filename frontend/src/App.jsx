import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import RequireRole from './components/RequireRole.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import CajaPage from './pages/CajaPage.jsx';
import StockPage from './pages/StockPage.jsx';
import VencimientosPage from './pages/VencimientosPage.jsx';
import ProveedoresPage from './pages/ProveedoresPage.jsx';
import ClientesEmpresaPage from './pages/ClientesEmpresaPage.jsx';
import ClienteEmpresaNuevoPage from './pages/ClienteEmpresaNuevoPage.jsx';
import ClienteEmpresaDetallePage from './pages/ClienteEmpresaDetallePage.jsx';
import PedidosClientePage from './pages/PedidosClientePage.jsx';
import CierreCajaPage from './pages/CierreCajaPage.jsx';
import CostosPage from './pages/CostosPage.jsx';
import UsuariosPage from './pages/UsuariosPage.jsx';
import ConfiguracionPage from './pages/ConfiguracionPage.jsx';
import PortalLoginPage from './pages/PortalLoginPage.jsx';
import PortalPage from './pages/PortalPage.jsx';
import SuperadminPage from './pages/SuperadminPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Portal del cliente-empresa: sesión propia, sin el menú ni las rutas internas. */}
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route path="/portal" element={<PortalPage />} />

        {/* Administración de CEA sobre esta instalación: cuenta y sesión propias, sin el menú del negocio. */}
        {/* Un solo ingreso: el superadmin entra por /login y llega al panel. */}
        <Route path="/sa/login" element={<Navigate to="/login" replace />} />
        <Route path="/sa" element={<SuperadminPage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/caja" replace />} />
          <Route path="caja" element={<CajaPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="vencimientos" element={<VencimientosPage />} />
          <Route
            path="proveedores"
            element={
              <RequireRole modulo="proveedores">
                <ProveedoresPage />
              </RequireRole>
            }
          />
          <Route path="clientes-empresa" element={<RequireRole modulo="clientes-empresa" />}>
            <Route index element={<ClientesEmpresaPage />} />
            <Route path="nuevo" element={<ClienteEmpresaNuevoPage />} />
            <Route path=":id" element={<ClienteEmpresaDetallePage />} />
          </Route>
          <Route
            path="pedidos-cliente"
            element={
              <RequireRole modulo="pedidos-cliente">
                <PedidosClientePage />
              </RequireRole>
            }
          />
          <Route path="cierre-caja" element={<CierreCajaPage />} />
          <Route
            path="costos"
            element={
              <RequireRole modulo="costos">
                <CostosPage />
              </RequireRole>
            }
          />
          <Route
            path="usuarios"
            element={
              <RequireRole modulo="usuarios">
                <UsuariosPage />
              </RequireRole>
            }
          />
          <Route
            path="configuracion"
            element={
              <RequireRole modulo="configuracion">
                <ConfiguracionPage />
              </RequireRole>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

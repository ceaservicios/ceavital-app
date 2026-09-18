import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import './AppLayout.css';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout-main">
        <Topbar />
        <div className="app-layout-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

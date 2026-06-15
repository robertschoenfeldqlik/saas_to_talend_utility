import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="ed-root flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
        <Outlet />
      </main>
    </div>
  );
}

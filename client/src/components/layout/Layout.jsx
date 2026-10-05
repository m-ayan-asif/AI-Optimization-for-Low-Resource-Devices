import { Outlet } from 'react-router-dom';
import Header from './Header';
import OfflineStatus from './OfflineStatus';

export default function Layout() {
  return (
    <div className="min-h-screen bg-paper">
      <Header />
      <OfflineStatus />
      <main className="max-w-6xl mx-auto px-4 py-7">
        <Outlet />
      </main>
    </div>
  );
}

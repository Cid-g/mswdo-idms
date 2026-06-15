import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function AppLayout({ children }) {
  const location = useLocation();
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar />
      {/* key forces remount on navigation → re-triggers page-enter animation */}
      <main
        key={location.pathname}
        className="flex-1 overflow-y-auto px-8 py-6"
      >
        {children}
      </main>
    </div>
  );
}

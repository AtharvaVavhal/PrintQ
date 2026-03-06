import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

const NAV = [
  { to: '/',         icon: '📊', label: 'Dashboard' },
  { to: '/jobs',     icon: '📋', label: 'Job Queue'  },
  { to: '/printers', icon: '🖨️', label: 'Printers'  },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const navigate          = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px', background: 'white', borderRight: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 100
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.8rem' }}>🖨️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e293b' }}>PrintQ</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Admin Dashboard</div>
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <nav style={{ flex: 1, padding: '16px 12px' }}>
          {NAV.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px', borderRadius: '8px', marginBottom: '4px',
                textDecoration: 'none', fontWeight: 500, fontSize: '0.9rem',
                background: isActive ? '#eef2ff' : 'transparent',
                color: isActive ? '#6366f1' : '#64748b',
                transition: 'all 0.15s'
              })}
            >
              <span>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>

        {/* Admin Info */}
        <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '4px' }}>
            {admin?.name}
          </div>
          <div style={{
            fontSize: '0.7rem', color: '#94a3b8',
            background: '#f1f5f9', padding: '2px 8px',
            borderRadius: '4px', display: 'inline-block', marginBottom: '8px'
          }}>
            {admin?.role}
          </div>
          <button onClick={handleLogout} style={{
            display: 'block', width: '100%', padding: '8px',
            background: 'none', border: '1px solid #e2e8f0',
            borderRadius: '8px', cursor: 'pointer', color: '#64748b',
            fontSize: '0.85rem'
          }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ marginLeft: '240px', flex: 1, padding: '32px', minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}
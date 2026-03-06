import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail]       = useState('admin@printq.local');
  const [password, setPassword] = useState('Admin@1234');
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuth();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f8fafc', padding: '20px'
    }}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '40px',
        width: '100%', maxWidth: '400px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '3rem' }}>🖨️</div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e293b', margin: '8px 0 4px' }}>
            PrintQ Admin
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Sign in to manage print jobs</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle} required
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle} required
            />
          </div>
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.8rem', fontWeight: 600,
  color: '#64748b', marginBottom: '6px', textTransform: 'uppercase',
  letterSpacing: '0.5px'
};
const inputStyle = {
  width: '100%', padding: '10px 14px', border: '1.5px solid #e2e8f0',
  borderRadius: '8px', fontSize: '0.95rem', color: '#1e293b',
  outline: 'none', boxSizing: 'border-box'
};
const btnStyle = {
  width: '100%', padding: '12px', background: '#6366f1', color: 'white',
  border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 600,
  cursor: 'pointer'
};
import { useState, useEffect } from 'react';
import api from '../lib/api';

export function useAuth() {
  const [admin, setAdmin]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('printq_token');
    if (!token) { setLoading(false); return; }

    api.get('/auth/me')
      .then(({ data }) => setAdmin(data.admin))
      .catch(() => localStorage.removeItem('printq_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('printq_token', data.accessToken);
    setAdmin(data.admin);
    return data.admin;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    localStorage.removeItem('printq_token');
    setAdmin(null);
  };

  return { admin, loading, login, logout };
}
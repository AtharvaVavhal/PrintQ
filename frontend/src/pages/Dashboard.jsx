import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { format, subDays } from 'date-fns';
import api from '../lib/api';
import { connectSocket } from '../lib/socket';

const COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6'];

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetchData();
    const socket = connectSocket();
    socket.on('job:status', () => fetchData());
    return () => socket.off('job:status');
  }, []);

  const fetchData = async () => {
    try {
      const { data } = await api.get('/admin/analytics?days=7');
      setAnalytics(data);
    } finally {
      setLoading(false);
    }
  };

  const summary    = analytics?.summary    || {};
  const daily      = analytics?.daily      || [];
  const statusDist = analytics?.statusDist || [];

  // Normalise daily data so all 7 days appear even with no jobs
  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date  = subDays(new Date(), 6 - i);
    const label = format(date, 'MMM d');
    const day   = daily.find(d => format(new Date(d.date), 'MMM d') === label) || {};
    return {
      date:    label,
      jobs:    parseInt(day.jobs    || '0', 10),
      revenue: parseInt(day.revenue_paise || '0', 10) / 100,
    };
  });

  const statusData = statusDist
    .map(d => ({ name: d.status.replace(/_/g, ' '), value: parseInt(d.count, 10) }))
    .filter(d => d.value > 0);

  const stats = {
    total:     parseInt(summary.total_jobs          || '0', 10),
    completed: parseInt(summary.completed_jobs      || '0', 10),
    queued:    parseInt(summary.active_jobs         || '0', 10),
    revenue:   parseInt(summary.total_revenue_paise || '0', 10),
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading dashboard...</div>;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
        Dashboard
      </h1>
      <p style={{ color: '#64748b', marginBottom: '28px' }}>
        {format(new Date(), 'EEEE, MMMM d yyyy')}
      </p>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Total Jobs',   value: stats.total,                              icon: '📋', color: '#6366f1' },
          { label: 'Completed',    value: stats.completed,                           icon: '✅', color: '#22c55e' },
          { label: 'Active',       value: stats.queued,                              icon: '⏳', color: '#f59e0b' },
          { label: 'Revenue',      value: `₹${(stats.revenue / 100).toFixed(0)}`,  icon: '💰', color: '#8b5cf6' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{
            background: 'white', borderRadius: '12px', padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            borderLeft: `4px solid ${color}`
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{icon}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e293b' }}>{value}</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Extra summary pills */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {[
          { label: 'Pages Printed', value: parseInt(summary.total_pages_printed || '0', 10).toLocaleString() },
          { label: 'Failed Jobs',   value: parseInt(summary.failed_jobs         || '0', 10) },
          { label: 'Refunded',      value: `₹${(parseInt(summary.total_refunded_paise || '0', 10) / 100).toFixed(0)}` },
          { label: 'Avg Job Value', value: `₹${(parseInt(summary.avg_job_value_paise  || '0', 10) / 100).toFixed(2)}` },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: 'white', borderRadius: '8px', padding: '10px 18px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', gap: '10px', alignItems: 'center'
          }}>
            <span style={{ fontWeight: 700, color: '#1e293b' }}>{value}</span>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '28px' }}>
        {/* Area Chart */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>
            Jobs (Last 7 Days)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorJobs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="jobs" stroke="#6366f1"
                fill="url(#colorJobs)" strokeWidth={2} name="Jobs" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>
            Status Distribution
          </h3>
          {statusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={40}
                    outerRadius={70} dataKey="value">
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                {statusData.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: '#94a3b8', textAlign: 'center', paddingTop: '40px' }}>No data yet</div>
          )}
        </div>
      </div>

      {/* Revenue Bar Chart */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>
          Daily Revenue (₹)
        </h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [`₹${v.toFixed(2)}`, 'Revenue']} />
            <Bar dataKey="revenue" fill="#6366f1" radius={[4,4,0,0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
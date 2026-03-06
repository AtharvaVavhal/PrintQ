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
  const [stats, setStats]   = useState(null);
  const [jobs, setJobs]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const socket = connectSocket();
    socket.on('job:status', () => fetchData());
    return () => socket.off('job:status');
  }, []);

  const fetchData = async () => {
    try {
      const { data } = await api.get('/jobs?limit=100');
      const jobs = data.jobs || [];
      setJobs(jobs);

      // Compute stats
      const total    = jobs.length;
      const completed = jobs.filter(j => j.status === 'completed').length;
      const queued   = jobs.filter(j => j.status === 'queued').length;
      const revenue  = jobs
        .filter(j => ['queued','processing','printing','completed'].includes(j.status))
        .reduce((sum, j) => sum + j.amount_paise, 0);

      setStats({ total, completed, queued, revenue });
    } finally {
      setLoading(false);
    }
  };

  // Build last 7 days chart data
  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date  = subDays(new Date(), 6 - i);
    const label = format(date, 'MMM d');
    const dayJobs = jobs.filter(j =>
      format(new Date(j.created_at), 'MMM d') === label
    );
    return {
      date: label,
      jobs:    dayJobs.length,
      revenue: dayJobs.reduce((s, j) => s + j.amount_paise / 100, 0),
    };
  });

  // Status distribution for pie chart
  const statusData = ['pending_payment','queued','printing','completed','failed']
    .map(s => ({
      name:  s.replace(/_/g,' '),
      value: jobs.filter(j => j.status === s).length,
    }))
    .filter(d => d.value > 0);

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
          { label: 'Total Jobs',   value: stats?.total,                  icon: '📋', color: '#6366f1' },
          { label: 'Completed',    value: stats?.completed,              icon: '✅', color: '#22c55e' },
          { label: 'In Queue',     value: stats?.queued,                 icon: '⏳', color: '#f59e0b' },
          { label: 'Revenue',      value: `₹${((stats?.revenue||0)/100).toFixed(0)}`, icon: '💰', color: '#8b5cf6' },
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

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '28px' }}>
        {/* Area Chart */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>
            Jobs & Revenue (Last 7 Days)
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
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="jobs" stroke="#6366f1"
                fill="url(#colorJobs)" strokeWidth={2} name="Jobs" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>
            Job Status Distribution
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
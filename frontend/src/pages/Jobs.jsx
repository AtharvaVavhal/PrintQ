import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import api from '../lib/api';
import { connectSocket } from '../lib/socket';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  pending_payment:   { bg: '#fef3c7', color: '#92400e' },
  payment_confirmed: { bg: '#dbeafe', color: '#1e40af' },
  queued:            { bg: '#e0e7ff', color: '#3730a3' },
  processing:        { bg: '#fce7f3', color: '#9d174d' },
  printing:          { bg: '#d1fae5', color: '#065f46' },
  completed:         { bg: '#dcfce7', color: '#166534' },
  failed:            { bg: '#fee2e2', color: '#991b1b' },
  refunded:          { bg: '#f1f5f9', color: '#475569' },
};

export default function Jobs() {
  const [jobs, setJobs]         = useState([]);
  const [filter, setFilter]     = useState('all');
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchJobs();
    const socket = connectSocket();
    socket.on('job:status', ({ jobId, status }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j));
      toast(`Job ${jobId.slice(0,8)}... → ${status}`, { icon: '🖨️' });
    });
    return () => socket.off('job:status');
  }, []);

  const fetchJobs = async () => {
    try {
      const url = filter !== 'all' ? `/jobs?status=${filter}` : '/jobs?limit=100';
      const { data } = await api.get(url);
      setJobs(data.jobs || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, [filter]);

  const filteredJobs = filter === 'all'
    ? jobs
    : jobs.filter(j => j.status === filter);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>Job Queue</h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>{filteredJobs.length} jobs</p>
        </div>
        <button onClick={fetchJobs} style={{
          padding: '8px 16px', background: '#6366f1', color: 'white',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
        }}>
          🔄 Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {['all','pending_payment','queued','printing','completed','failed'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '6px 14px', borderRadius: '20px', border: 'none',
            cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
            background: filter === s ? '#6366f1' : '#f1f5f9',
            color: filter === s ? 'white' : '#64748b',
          }}>
            {s === 'all' ? 'All' : s.replace(/_/g,' ')}
          </button>
        ))}
      </div>

      {/* Jobs Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Job ID','Student','File','Pages','Amount','Status','Created',''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem',
                  fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                Loading...
              </td></tr>
            ) : filteredJobs.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                No jobs found
              </td></tr>
            ) : filteredJobs.map((job, i) => {
              const sc = STATUS_COLORS[job.status] || STATUS_COLORS.pending_payment;
              return (
                <tr key={job.id} style={{
                  borderBottom: '1px solid #f1f5f9',
                  background: selected === job.id ? '#fafafa' : 'white'
                }}>
                  <td style={{ padding: '12px 16px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#6366f1' }}>
                    {job.id.slice(0,8)}...
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#1e293b' }}>
                    {job.student_email}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.8rem', color: '#64748b', maxWidth: '150px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.original_filename}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#1e293b', textAlign: 'center' }}>
                    {job.page_count}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                    ₹{(job.amount_paise / 100).toFixed(2)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ ...sc, padding: '3px 10px', borderRadius: '20px',
                      fontSize: '0.75rem', fontWeight: 600 }}>
                      {job.status.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.8rem', color: '#64748b' }}>
                    {format(new Date(job.created_at), 'MMM d, HH:mm')}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button onClick={() => setSelected(selected === job.id ? null : job.id)}
                      style={{ padding: '4px 10px', background: '#f1f5f9', border: 'none',
                        borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', color: '#64748b' }}>
                      {selected === job.id ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
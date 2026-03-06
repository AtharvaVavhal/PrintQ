import { useState, useEffect } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
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

const REFUNDABLE = ['payment_confirmed','queued','processing','failed','completed'];

export default function Jobs() {
  const [jobs, setJobs]           = useState([]);
  const [filter, setFilter]       = useState('all');
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [refunding, setRefunding] = useState(null);
  const [total, setTotal]         = useState(0);

  useEffect(() => {
    fetchJobs();
    const socket = connectSocket();
    socket.on('job:status', ({ jobId, status }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j));
      toast(`Job ${jobId.slice(0,8)}… → ${status}`, { icon: '🖨️' });
    });
    return () => socket.off('job:status');
  }, []);

  useEffect(() => { fetchJobs(); }, [filter]);

  const fetchJobs = async () => {
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filter !== 'all') params.set('status', filter);
      const { data } = await api.get(`/admin/jobs?${params}`);
      setJobs(data.jobs  || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (job) => {
    if (!window.confirm(`Refund ₹${(job.amount_paise / 100).toFixed(2)} for job ${job.id.slice(0,8)}?`)) return;
    setRefunding(job.id);
    try {
      await api.post(`/admin/refund/${job.id}`, { reason: 'Admin manual refund' });
      toast.success('Refund issued successfully');
      fetchJobs();
      if (selected === job.id) setSelected(null);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Refund failed');
    } finally {
      setRefunding(null);
    }
  };

  const toggleDetail = (id) => setSelected(prev => prev === id ? null : id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>Job Queue</h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>{total} total jobs</p>
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
        {['all','pending_payment','payment_confirmed','queued','printing','completed','failed','refunded'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '6px 14px', borderRadius: '20px', border: 'none',
            cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
            background: filter === s ? '#6366f1' : '#f1f5f9',
            color:      filter === s ? 'white'   : '#64748b',
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
            ) : jobs.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                No jobs found
              </td></tr>
            ) : jobs.map((job) => {
              const sc = STATUS_COLORS[job.status] || STATUS_COLORS.pending_payment;
              const isOpen = selected === job.id;
              return (
                <>
                  <tr key={job.id} style={{
                    borderBottom: isOpen ? 'none' : '1px solid #f1f5f9',
                    background:   isOpen ? '#fafafa' : 'white',
                    cursor: 'pointer',
                  }} onClick={() => toggleDetail(job.id)}>
                    <td style={{ padding: '12px 16px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#6366f1' }}>
                      {job.id.slice(0,8)}…
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#1e293b' }}>
                      <div>{job.student_email}</div>
                      {job.student_name && (
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{job.student_name}</div>
                      )}
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
                      <span style={{ color: '#6366f1', fontSize: '0.85rem' }}>
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </td>
                  </tr>

                  {/* ── Detail Panel ─────────────────────────────────── */}
                  {isOpen && (
                    <tr key={`${job.id}-detail`}>
                      <td colSpan={8} style={{
                        padding: '0 16px 20px', background: '#fafafa',
                        borderBottom: '1px solid #e2e8f0',
                      }}>
                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                          gap: '16px', paddingTop: '16px'
                        }}>

                          {/* Column 1 — Job info */}
                          <div style={{ background: 'white', borderRadius: '10px', padding: '16px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#64748b',
                              textTransform: 'uppercase', marginBottom: '12px' }}>Job Details</div>
                            <Detail label="Full ID"       value={<code style={{ fontSize: '0.75rem' }}>{job.id}</code>} />
                            <Detail label="QR Token"      value={<code style={{ fontSize: '0.75rem' }}>{job.qr_token?.slice(0,16)}…</code>} />
                            <Detail label="File Size"     value={formatBytes(job.file_size_bytes)} />
                            <Detail label="Printer"       value={job.printer_name || <em style={{ color: '#94a3b8' }}>Unassigned</em>} />
                            {job.printer_location && <Detail label="Location" value={job.printer_location} />}
                            {job.queued_at  && <Detail label="Queued At"  value={format(new Date(job.queued_at),  'MMM d, HH:mm:ss')} />}
                            {job.printed_at && <Detail label="Printed At" value={format(new Date(job.printed_at), 'MMM d, HH:mm:ss')} />}
                          </div>

                          {/* Column 2 — Print settings */}
                          <div style={{ background: 'white', borderRadius: '10px', padding: '16px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#64748b',
                              textTransform: 'uppercase', marginBottom: '12px' }}>Print Settings</div>
                            <Detail label="Copies"      value={job.settings?.copies ?? 1} />
                            <Detail label="Color"       value={job.settings?.color  ? '🎨 Yes' : '⬛ No'} />
                            <Detail label="Duplex"      value={job.settings?.duplex ? '📋 Yes' : '📄 No'} />
                            <Detail label="Paper Size"  value={job.settings?.paper_size  || 'A4'} />
                            <Detail label="Orientation" value={job.settings?.orientation || 'portrait'} />
                          </div>

                          {/* Column 3 — Payment + actions */}
                          <div style={{ background: 'white', borderRadius: '10px', padding: '16px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#64748b',
                              textTransform: 'uppercase', marginBottom: '12px' }}>Payment</div>
                            <Detail label="Status"  value={job.payment_status || '—'} />
                            <Detail label="Order ID" value={
                              job.razorpay_order_id
                                ? <code style={{ fontSize: '0.7rem' }}>{job.razorpay_order_id.slice(0,20)}…</code>
                                : '—'
                            } />
                            <Detail label="Payment ID" value={
                              job.razorpay_payment_id
                                ? <code style={{ fontSize: '0.7rem' }}>{job.razorpay_payment_id.slice(0,20)}…</code>
                                : '—'
                            } />

                            {/* Status history */}
                            {Array.isArray(job.status_history) && job.status_history.length > 0 && (
                              <div style={{ marginTop: '12px' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.75rem', color: '#64748b',
                                  textTransform: 'uppercase', marginBottom: '8px' }}>History</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {job.status_history.map((h, i) => (
                                    <div key={i} style={{ fontSize: '0.75rem', display: 'flex', gap: '8px' }}>
                                      <span style={{ color: '#94a3b8' }}>
                                        {h.at ? format(new Date(h.at), 'HH:mm:ss') : '—'}
                                      </span>
                                      <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                        {h.status?.replace(/_/g,' ')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Refund button */}
                            {REFUNDABLE.includes(job.status) && job.payment_status === 'paid' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRefund(job); }}
                                disabled={refunding === job.id}
                                style={{
                                  marginTop: '16px', width: '100%',
                                  padding: '8px', background: refunding === job.id ? '#f1f5f9' : '#fee2e2',
                                  color: '#991b1b', border: '1px solid #fecaca',
                                  borderRadius: '8px', cursor: refunding === job.id ? 'not-allowed' : 'pointer',
                                  fontWeight: 600, fontSize: '0.85rem',
                                }}>
                                {refunding === job.id ? 'Processing…' : '↩ Issue Refund'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Small helper components ───────────────────────────────────────────────────

function Detail({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0',
      borderBottom: '1px solid #f8fafc', fontSize: '0.82rem' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ fontWeight: 500, color: '#1e293b', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes)             return '—';
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
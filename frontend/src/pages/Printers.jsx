import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import api from '../lib/api';

const STATUS_COLORS = {
  online:  { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  offline: { bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' },
  busy:    { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  error:   { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
};

export default function Printers() {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetchPrinters();
    const interval = setInterval(fetchPrinters, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchPrinters = async () => {
    try {
      const { data } = await api.get('/admin/printers');
      setPrinters(data.printers || []);
    } catch {
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>Printers</h1>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Monitor printer status and health</p>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8' }}>Loading printers...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px,1fr))', gap: '16px' }}>
          {printers.map(printer => {
            const sc = STATUS_COLORS[printer.status] || STATUS_COLORS.offline;
            return (
              <div key={printer.id} style={{
                background: 'white', borderRadius: '12px', padding: '24px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                borderTop: `3px solid ${sc.dot}`
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{printer.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                      📍 {printer.location}
                    </div>
                  </div>
                  <span style={{ ...sc, padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: sc.dot, marginRight: '6px' }} />
                    {printer.status}
                  </span>
                </div>

                {/* Capabilities */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {printer.capabilities?.color && (
                    <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 10px',
                      borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>🎨 Color</span>
                  )}
                  {printer.capabilities?.duplex && (
                    <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 10px',
                      borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>📋 Duplex</span>
                  )}
                  <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 10px',
                    borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>
                    Max {printer.capabilities?.max_pages} pages
                  </span>
                </div>

                {/* Heartbeat */}
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                  {printer.last_heartbeat
                    ? `Last seen: ${formatDistanceToNow(new Date(printer.last_heartbeat))} ago`
                    : 'Never connected'}
                </div>

                {/* Job stats */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    📋 {printer.total_jobs || 0} total jobs
                  </span>
                  {parseInt(printer.queued_jobs || '0', 10) > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>
                      ⏳ {printer.queued_jobs} queued
                    </span>
                  )}
                  {parseInt(printer.active_jobs || '0', 10) > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 600 }}>
                      🖨️ {printer.active_jobs} printing
                    </span>
                  )}
                </div>

                {/* Printer ID */}
                <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '4px', fontFamily: 'monospace' }}>
                  ID: {printer.id.slice(0,16)}...
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
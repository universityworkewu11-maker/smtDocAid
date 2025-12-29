import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

const DoctorNotificationsPage = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingRead, setMarkingRead] = useState(null);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // If a doctors row exists linking to this auth user, prefer that id for doctor lookup
      const { data: doctorRow } = await supabase
        .from('doctors')
        .select('id, user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const doctorIdForQuery = doctorRow?.id || null;

      const baseSelect = `
        id,
        message,
        type,
        is_read,
        created_at,
        diagnosis_id,
        patient_id,
        patient:patient_id (
          id,
          user_id,
          full_name,
          name,
          email
        ),
        diagnosis:diagnosis_id (
          content,
          severity,
          created_at
        )
      `;

      let data = null;
      let error = null;

      // Try to query notifications. Prefer matching by doctor_id = auth uid, but if a doctors.id exists, include it as an alternative.
      try {
        if (doctorIdForQuery) {
          ({ data, error } = await supabase
            .from('notifications')
            .select(baseSelect)
            .or(`doctor_id.eq.${user.id},doctor_id.eq.${doctorIdForQuery}`)
            .order('created_at', { ascending: false }));
        } else {
          ({ data, error } = await supabase
            .from('notifications')
            .select(baseSelect)
            .eq('doctor_id', user.id)
            .order('created_at', { ascending: false }));
        }
        if (error) throw error;
      } catch (err) {
        // If the column is missing or another schema issue, try safer fallbacks: query by doctor_id only (already attempted), or by doctors.id if present.
        const msg = err?.message || String(err);
        if (msg.includes('doctor_id') || (err?.code === '42703')) {
          try {
            if (doctorIdForQuery) {
              const q = await supabase
                .from('notifications')
                .select(baseSelect)
                .eq('doctor_id', doctorIdForQuery)
                .order('created_at', { ascending: false });
              data = q.data;
              error = q.error;
              if (error) throw error;
            }
          } catch (err2) {
            throw err2;
          }
        } else {
          throw err;
        }
      }

      setNotifications(data || []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId) => {
    setMarkingRead(notificationId);
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId ? { ...n, is_read: true } : n
        )
      );
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setMarkingRead(null);
    }
  };

  const viewPatientReport = (notification) => {
    const patientIdentifier = notification.patient?.user_id || notification.patient?.id || notification.patient_id;
    if (!patientIdentifier) {
      setError('Unable to open patient record. Missing identifier.');
      return;
    }
    navigate(`/doctor/patient/${patientIdentifier}`, {
      state: {
        name: notification.patient?.full_name || notification.patient?.name
      }
    });
  };

  return (
    <main>
      <section className="hero animate-fade-up">
        <h1 className="hero-title">My Notifications</h1>
        <p className="hero-subtitle">View shared patient reports and updates.</p>
        <div className="hero-parallax-layer" aria-hidden="true">
          <div className="blob indigo"></div>
          <div className="blob cyan"></div>
        </div>
      </section>

      <div className="card">
        {error && <div className="alert alert-danger">{error}</div>}
        {loading ? (
          <div className="feature-grid" style={{ marginTop: 12 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="feature-card tilt">
                <div className="skeleton animate" style={{ height: 20, width: '80%', marginBottom: 12 }} />
                <div className="skeleton animate" style={{ height: 16, width: '60%', marginBottom: 8 }} />
                <div className="skeleton animate" style={{ height: 16, width: '40%' }} />
              </div>
            ))}
          </div>
        ) : notifications.length > 0 ? (
          <div className="notifications-list">
            {notifications.map(notification => (
              <div
                key={notification.id}
                className={`notification-item ${notification.is_read ? 'read' : 'unread'}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '12px',
                  background: notification.is_read ? '#f8fafc' : '#ffffff',
                  position: 'relative'
                }}
              >
                {!notification.is_read && (
                  <div
                    className="unread-indicator"
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      width: '8px',
                      height: '8px',
                      background: '#3b82f6',
                      borderRadius: '50%'
                    }}
                  />
                )}
                <div className="notification-header" style={{ marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                    {notification.patient?.full_name || notification.patient?.name || 'Patient'}
                  </h4>
                  <small className="muted" style={{ fontSize: '12px' }}>
                    {new Date(notification.created_at).toLocaleString()}
                  </small>
                </div>
                <p style={{ margin: '8px 0', fontSize: '14px' }}>
                  {notification.message}
                </p>
                {notification.diagnosis && (
                  <div className="report-preview" style={{ marginTop: '12px' }}>
                    <div
                      className={`badge ${notification.diagnosis.severity === 'high' ? 'badge-high' : notification.diagnosis.severity === 'medium' ? 'badge-medium' : 'badge-low'}`}
                      style={{ marginBottom: '8px' }}
                    >
                      Severity: {notification.diagnosis.severity || 'low'}
                    </div>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontSize: '13px',
                        background: '#f1f5f9',
                        padding: '8px',
                        borderRadius: '4px',
                        maxHeight: '120px',
                        overflow: 'hidden'
                      }}
                    >
                      {notification.diagnosis.content?.slice(0, 300)}...
                    </pre>
                  </div>
                )}
                <div className="notification-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => viewPatientReport(notification)}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    View Full Report
                  </button>
                  {!notification.is_read && (
                    <button
                      className="btn btn-light"
                      onClick={() => markAsRead(notification.id)}
                      disabled={markingRead === notification.id}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      {markingRead === notification.id ? 'Marking...' : 'Mark as Read'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No notifications yet. Patient reports shared with you will appear here.</p>
          </div>
        )}
      </div>
    </main>
  );
};

export default DoctorNotificationsPage;
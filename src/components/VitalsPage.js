import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module

const stripTrailingSlash = (url = '') => url.replace(/\/$/, '');

const VitalsPage = () => {
  const navigate = useNavigate();
  const serverBase = useMemo(() => {
    const envBase = stripTrailingSlash(process.env.REACT_APP_SERVER_BASE || process.env.REACT_APP_SERVER_URL || '');
    if (envBase) return envBase;
    if (typeof window !== 'undefined') return stripTrailingSlash(window.location.origin);
    return '';
  }, []);
  const [currentStep, setCurrentStep] = useState(0);
  const [vitalsData, setVitalsData] = useState({
    temperature: { value: null, status: 'pending', timestamp: null, confirmed: false },
    heartRate: { value: null, status: 'pending', timestamp: null, confirmed: false },
    spo2: { value: null, status: 'pending', timestamp: null, confirmed: false }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [previousVitals, setPreviousVitals] = useState(null);

  const vitalsConfig = [
    {
      key: 'temperature',
      name: 'Temperature',
      unit: '°F',
      icon: '🌡️',
      pin: 4,
      normalRange: { min: 97, max: 99.5 },
      color: '#ff6b6b'
    },
    {
      key: 'heartRate',
      name: 'Heart Rate',
      unit: 'bpm',
      icon: '❤️',
      pin: 17,
      normalRange: { min: 60, max: 100 },
      color: '#4ecdc4'
    },
    {
      key: 'spo2',
      name: 'SpO₂',
      unit: '%',
      icon: '🫁',
      pin: 27,
      normalRange: { min: 95, max: 100 },
      color: '#45b7d1'
    }
  ];

  const currentVital = vitalsConfig[currentStep];
  const allVitalsConfirmed = Object.values(vitalsData).every(vital => vital.confirmed);

  // Load previous vitals from Supabase (public.vitals) or fallback to localStorage
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id;
        if (uid) {
          // Try to fetch latest vitals from a table if it exists
          const { data, error } = await supabase
            .from('vitals')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!error && Array.isArray(data) && data.length > 0) {
            const row = data[0];
            const prev = {
              temperature: row.temperature ?? null,
              heartRate: row.heart_rate ?? null,
              spo2: row.spo2 ?? null,
              timestamp: row.created_at || row.updated_at || null
            };
            setPreviousVitals(prev);
          } else {
            // Fallback to localStorage snapshot
            try {
              const ld = JSON.parse(window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data') || 'null');
              if (ld) {
                const prev = {
                  temperature: ld.temperature?.value ?? null,
                  heartRate: ld.heartRate?.value ?? null,
                  spo2: ld.spo2?.value ?? null,
                  timestamp: ld.temperature?.timestamp || ld.heartRate?.timestamp || ld.spo2?.timestamp || null
                };
                setPreviousVitals(prev);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    })();
  }, []);

  // Raspberry Pi API integration
  const takeVitalReading = async (vitalType) => {
    setIsLoading(true);
    setError('');

    try {
      const url = `${serverBase || ''}/api/vitals`;
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) {
        throw new Error('Failed to fetch vitals from ingestion server');
      }
      const data = await response.json();

      // Server stores latest Raspi payload; map to UI keys
      const valueMap = {
        temperature: data.temperature ?? data.object_temp_C ?? null,
        heartRate: data.heartRate ?? data.heart_rate ?? data.heart_rate_bpm ?? null,
        spo2: data.spo2 ?? data.spo2_percent ?? null
      };
      const value = valueMap[vitalType];

      if (value !== null && value !== undefined) {
        const timestamp = new Date().toISOString();
        setVitalsData(prev => ({
          ...prev,
          [vitalType]: {
            value: value,
            status: 'measured',
            timestamp,
            confirmed: false
          }
        }));
      } else {
        throw new Error(`No ${vitalType} reading available yet. Ensure your Raspberry Pi is posting data.`);
      }
    } catch (err) {
      setError(err.message);
      setVitalsData(prev => ({
        ...prev,
        [vitalType]: {
          ...prev[vitalType],
          status: 'error'
        }
      }));
    } finally {
      setIsLoading(false);
    }
  };


  const confirmVital = () => {
    setVitalsData(prev => ({
      ...prev,
      [currentVital.key]: {
        ...prev[currentVital.key],
        confirmed: true,
        status: 'confirmed'
      }
    }));

    if (currentStep < vitalsConfig.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const retakeVital = () => {
    setVitalsData(prev => ({
      ...prev,
      [currentVital.key]: {
        value: null,
        status: 'pending',
        timestamp: null,
        confirmed: false
      }
    }));
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return 'var(--success)';
      case 'measured':
        return 'var(--warning)';
      case 'error':
        return 'var(--danger)';
      case 'skipped':
        return 'var(--gray-500)';
      default:
        return 'var(--gray-400)';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'confirmed':
        return 'Confirmed';
      case 'measured':
        return 'Ready to Confirm';
      case 'error':
        return 'Error';
      case 'skipped':
        return 'Skipped';
      default:
        return 'Not Measured';
    }
  };

  const isValueNormal = (value, range) => {
    return value >= range.min && value <= range.max;
  };

  const handleNext = async () => {
    // Store vitals data and navigate to next step
    localStorage.setItem('vitalsData', JSON.stringify(vitalsData));

    // Upload vitals to backend
    try {
      const uploadUrl = `${serverBase || ''}/api/vitals`;
      const vitalsToUpload = {
        temperature: vitalsData.temperature.value,
        heartRate: vitalsData.heartRate.value,
        spo2: vitalsData.spo2.value
      };
      await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vitalsToUpload)
      });
    } catch (error) {
      console.error('Failed to upload vitals:', error);
    }

    navigate('/patient/uploads');
  };

  const handleSkip = () => {
    // Persist whatever is available and move on
    try { localStorage.setItem('vitalsData', JSON.stringify(vitalsData)); } catch (_) {}
    navigate('/patient/uploads');
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      navigate('/patient');
    }
  };

  return (
    <main>
      {/* Hero header for consistent modern look */}
  <section className="hero animate-fade-up">
        <h1 className="hero-title">Vital Signs Assessment</h1>
        <p className="hero-subtitle">Measure your Temperature, Heart Rate, and SpO₂ with guided steps and clear status.</p>
        <div className="hero-cta">
          <button className="btn btn-light" onClick={() => navigate('/patient')}>Back to Patient Overview</button>
        </div>
  <div className="hero-stats stagger">
          <div className="hero-stat"><div className="text-xl font-semibold">Steps</div><div className="text-3xl font-extrabold">3</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Status</div><div className="text-3xl font-extrabold">{allVitalsConfirmed ? 'Ready' : 'In‑progress'}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Time</div><div className="text-3xl font-extrabold">~3–5 min</div></div>
        </div>
        <div className="hero-parallax-layer" aria-hidden="true">
          <div className="blob indigo"></div>
          <div className="blob cyan"></div>
        </div>
      </section>

      <div className="card">
        <div className="assessment-header">
          <h2 className="card-title">Follow the steps below</h2>
          <div className="progress-indicator">
            <div className="progress-steps">
              {vitalsConfig.map((vital, index) => (
                <div
                  key={vital.key}
                  className={`progress-step ${index <= currentStep ? 'active' : ''} ${
                    vitalsData[vital.key]?.confirmed ? 'completed' : ''
                  }`}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-label">{vital.name}</div>
                </div>
              ))}
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${((currentStep + (vitalsData[currentVital.key]?.confirmed ? 1 : 0)) / vitalsConfig.length) * 100}%`
                }}
              />
            </div>
          </div>
        </div>

        <div className="vitals-container">
          {/* Current Vital Display */}
          <div className="current-vital-card tilt reveal">
              <div className="vital-header">
              <div className={`vital-icon ${isLoading ? 'pulsing' : ''}`}>{currentVital.icon}</div>
              <div className="vital-info">
                <h2>{currentVital.name}</h2>
                <p>Pin {currentVital.pin} • {currentVital.unit}</p>
              </div>
              <div
                className="vital-status"
                style={{ backgroundColor: getStatusColor(vitalsData[currentVital.key]?.status) }}
              >
                {getStatusText(vitalsData[currentVital.key]?.status)}
              </div>
            </div>

            {typeof vitalsData[currentVital.key]?.value === 'number' && (
              <div className="vital-reading">
                <div className="reading-value">
                  <span className="value">{vitalsData[currentVital.key].value}</span>
                  <span className="unit">{currentVital.unit}</span>
                </div>
                <div className={`reading-status ${isValueNormal(vitalsData[currentVital.key].value, currentVital.normalRange) ? 'normal' : 'abnormal'}`}>
                  {isValueNormal(vitalsData[currentVital.key].value, currentVital.normalRange) ? 'Normal Range' : 'Outside Normal Range'}
                </div>
                {vitalsData[currentVital.key].timestamp && (
                  <div className="reading-timestamp">
                    Measured: {new Date(vitalsData[currentVital.key].timestamp).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <div className="vital-actions">
              <button
                className="btn btn-primary"
                onClick={() => takeVitalReading(currentVital.key)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="spinner" />
                    Taking Reading...
                  </>
                ) : (
                  <>
                    📡 Take {currentVital.name}
                  </>
                )}
              </button>

              {vitalsData[currentVital.key]?.status === 'measured' && (
                <div className="confirmation-buttons">
                  <button className="btn btn-success" onClick={confirmVital}>
                    ✅ Confirm
                  </button>
                  <button className="btn btn-secondary" onClick={retakeVital}>
                    🔄 Retake
                  </button>
                </div>
              )}
              {vitalsData[currentVital.key]?.status === 'pending' && !isLoading && (
                <div className="muted" style={{marginTop:12}}>No reading yet. Click "Take {currentVital.name}".</div>
              )}
              {isLoading && (
                <div className="skeleton animate" style={{height:56, marginTop:16, borderRadius:'0.75rem'}} />
              )}
            </div>
          </div>

          {/* All Vitals Summary */}
          <div className="vitals-summary reveal">
            <h3>All Vital Signs</h3>
            <div className="vitals-grid">
              {vitalsConfig.map((vital) => (
                <div
                  key={vital.key}
                  className={`vital-summary-item ${vitalsData[vital.key]?.confirmed ? 'confirmed' : ''} ${
                    vital.key === currentVital.key ? 'current' : ''
                  }`}
                >
                  <div className="vital-summary-icon">{vital.icon}</div>
                  <div className="vital-summary-info">
                    <div className="vital-summary-name">{vital.name}</div>
                    <div className="vital-summary-value">
                      {vitalsData[vital.key]?.value ? `${vitalsData[vital.key].value} ${vital.unit}` : '--'}
                    </div>
                    <div className="vital-summary-status" style={{ color: getStatusColor(vitalsData[vital.key]?.status) }}>
                      {getStatusText(vitalsData[vital.key]?.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger">
            {error}
          </div>
        )}

        {previousVitals && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="card-title">Previous Readings</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <strong>Temperature:</strong> {previousVitals.temperature ?? '--'} °F
              </div>
              <div>
                <strong>Heart Rate:</strong> {previousVitals.heartRate ?? '--'} bpm
              </div>
              <div>
                <strong>SpO₂:</strong> {previousVitals.spo2 ?? '--'} %
              </div>
            </div>
            {previousVitals.timestamp && (
              <div style={{ marginTop: 8, color: 'var(--gray-600)' }}>
                Last recorded: {new Date(previousVitals.timestamp).toLocaleString()}
              </div>
            )}
          </div>
        )}

        <div className="navigation-buttons">
          <button className="btn btn-secondary" onClick={handleBack}>
            ← Back
          </button>

          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={!allVitalsConfirmed}
          >
            {allVitalsConfirmed ? 'Next: Upload Documents →' : 'Complete All Vitals First'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleSkip}
            title="Skip vitals for now and continue"
          >
            Skip for now →
          </button>
        </div>
      </div>
    </main>
  );
};

export default VitalsPage;
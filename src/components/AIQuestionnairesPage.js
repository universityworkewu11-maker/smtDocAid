
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';

// Supabase client imported from centralized module
const SERVER_BASE = (() => {
  const env = (process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5001';
  }
  return '';
})();

function AIQuestionnairesPage() {
  const navigate = useNavigate();

  const [error, setError] = useState('');
  // Interview mode state (one-by-one questions)
  const [interview, setInterview] = useState({ sessionId: null, question: '', turns: [], done: false, report: '' });
  const [iAnswer, setIAnswer] = useState('');
  const [iLoading, setILoading] = useState({ start: false, next: false, report: false });
  const [health, setHealth] = useState({ checked: false, ok: false, detail: '' });
  const [serverBase, setServerBase] = useState(SERVER_BASE);
  const [selectedDoctors, setSelectedDoctors] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const LS_KEYS = {
    interview: 'interview_state_v1',
    base: 'api_server_base_v1',
    selectedDoctors: 'selected_doctors_v1'
  };

  // Generic POST helper with fallback to localhost:5001 if relative path fails
  const apiPostJSON = async (path, body) => {
    const attempt = async (base) => {
      const url = `${base || ''}${path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body || {})
      });
      const raw = await resp.text();
      let j; try { j = JSON.parse(raw); } catch {
        throw new Error(`Backend did not return JSON (status ${resp.status}). Is the server running?`);
      }
      if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      return j;
    };

    // 1) try current base (env/dev or relative)
    try {
      const j = await attempt(serverBase);
      return j;
    } catch (e1) {
      // 2) if not already using localhost:5001, try fallback
      if (serverBase !== 'http://localhost:5001') {
        try {
          const j2 = await attempt('http://localhost:5001');
          // update base to working fallback
          setServerBase('http://localhost:5001');
          return j2;
        } catch (e2) {
          throw e1; // surface original error
        }
      }
      throw e1;
    }
  };

  useEffect(() => {
    // Initial data fetch
    fetchDoctors();
    // Restore persisted server base and interview state
    try {
      const savedBase = window.localStorage.getItem(LS_KEYS.base);
      if (savedBase) setServerBase(savedBase);
    } catch (_) {}
    try {
      const raw = window.localStorage.getItem(LS_KEYS.interview);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && (parsed.sessionId || parsed.turns)) {
          setInterview({
            sessionId: parsed.sessionId || null,
            question: parsed.question || '',
            turns: Array.isArray(parsed.turns) ? parsed.turns : [],
            done: Boolean(parsed.done),
            report: parsed.report || ''
          });
        }
      }
    } catch (_) {}
    try {
      const savedDoctors = window.localStorage.getItem(LS_KEYS.selectedDoctors);
      if (savedDoctors) {
        const parsed = JSON.parse(savedDoctors);
        if (Array.isArray(parsed)) setSelectedDoctors(parsed);
      }
    } catch (_) {}
  }, []);

  // Persist interview and base whenever they change (simple durability against tab minimize/reload)
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEYS.base, serverBase || ''); } catch (_) {}
  }, [serverBase]);
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(interview)); } catch (_) {}
  }, [interview]);
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEYS.selectedDoctors, JSON.stringify(selectedDoctors)); } catch (_) {}
  }, [selectedDoctors]);

  useEffect(() => {
    if (!Array.isArray(doctors) || !doctors.length) return;
    setSelectedDoctors(prev => {
      if (!Array.isArray(prev) || !prev.length) return prev;
      let changed = false;
      const mapped = prev.map(id => {
        const match = doctors.find(doc => doc?.user_id === id || doc?.id === id);
        const normalized = match?.user_id || match?.id || id;
        if (normalized !== id) changed = true;
        return normalized;
      });
      if (!changed) return prev;
      return Array.from(new Set(mapped));
    });
  }, [doctors]);

  // Patient/context data for the right-side context panel (vitals, uploads, demographics)
  const [contextData, setContextData] = useState({ vitals: [], uploads: [], patient: {} });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ctx = await buildInterviewContext();
        if (mounted && ctx) setContextData(ctx);
      } catch (e) {
        console.error('Failed to load patient context:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const refreshContext = async () => {
    try {
      const ctx = await buildInterviewContext();
      setContextData(ctx);
    } catch (e) {
      console.error('refreshContext error', e);
    }
  };

  const fetchDoctors = async () => {
    try {
      console.log('Fetching doctors...');
      // Prefer the `doctors` table if present; fall back to `doctor_profiles` for backward compatibility
      let data = [];
      let err = null;
      try {
        console.log('Trying doctors table...');
        const res = await supabase
          .from('doctors')
          .select('id, user_id, name, email, specialist, bio, license_number, age, updated_at')
          .order('updated_at', { ascending: false })
          .limit(100);
        if (res.error) {
          console.log('Doctors table error:', res.error);
          throw res.error;
        }
        data = res.data || [];
        console.log('Doctors table data:', data);
      } catch (e) {
        err = e;
        console.log('Doctors table failed, trying doctor_profiles...');
      }

      if (!data || data.length === 0) {
        console.log('No data from doctors table, trying doctor_profiles...');
        const res2 = await supabase
          .from('doctor_profiles')
          .select('id, user_id, full_name, email, specialty, location, city, bio, updated_at')
          .order('updated_at', { ascending: false })
          .limit(100);
        if (res2.error && !data?.length) {
          console.log('Doctor_profiles error:', res2.error);
          throw (err || res2.error);
        }
        data = res2.data || data || [];
        console.log('Doctor_profiles data:', data);
      }

      console.log('Final doctors data:', data);
      setDoctors(data);
    } catch (err) {
      console.error('Error fetching doctors:', err);
      setError(`Failed to load doctors: ${err.message}`);
    }
  };

  

  // Legacy batch generator removed to avoid confusion with adaptive flow

  // ---------- Interview mode helpers ----------
  const buildInterviewContext = async () => {
    let vitals = [];
    let uploads = [];
    let patient = {};
    try {
      // Fetch latest vitals from server
      const vitalsResponse = await fetch(`${serverBase}/api/vitals`);
      if (vitalsResponse.ok) {
        const latestVitals = await vitalsResponse.json();
        if (latestVitals && typeof latestVitals === 'object') {
          const t = latestVitals.temperature ?? null;
          const h = latestVitals.heartRate ?? null;
          const s = latestVitals.spo2 ?? null;
          const ts = latestVitals.timestamp || null;
          vitals = [
            { type: 'temperature', value: t, unit: '°F' },
            { type: 'heartRate', value: h, unit: 'bpm' },
            { type: 'spo2', value: s, unit: '%' }
          ];
          if (ts) vitals.timestamp = ts;
        }
      } else {
        // Fallback to localStorage if server fetch fails
        let raw = null;
        if (typeof window !== 'undefined') {
          raw = window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data');
        }
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
          const t = parsed.temperature?.value ?? null;
          const h = parsed.heartRate?.value ?? null;
          const s = parsed.spo2?.value ?? null;
          const ts = parsed.temperature?.timestamp || parsed.heartRate?.timestamp || parsed.spo2?.timestamp || null;
          vitals = [
            { type: 'temperature', value: t, unit: '°F' },
            { type: 'heartRate', value: h, unit: 'bpm' },
            { type: 'spo2', value: s, unit: '%' }
          ];
          if (ts) vitals.timestamp = ts;
        }
      }
    } catch (_) {}
    // Patient profile (name, age, gender, phone)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      if (uid) {
        // Prefer patient_profiles table if present
        try {
          const { data, error } = await supabase
            .from('patient_profiles')
            .select('patient_id,name,gender,age,phone')
            .eq('user_id', uid)
            .single();
          if (!error && data) {
            patient = {
              id: data.patient_id || null,
              name: data.name || null,
              gender: data.gender || null,
              age: data.age || null,
              phone: data.phone || null
            };
          }
        } catch (_) {}
        // Fallback to profiles table basic fields if patient_profiles missing
        if (!patient.name) {
          try {
            const { data: prof, error: pErr } = await supabase
              .from('profiles')
              .select('full_name,phone,gender')
              .eq('id', uid)
              .single();
            if (!pErr && prof) {
              patient = {
                ...patient,
                name: patient.name || prof.full_name || null,
                phone: patient.phone || prof.phone || null,
                gender: patient.gender || prof.gender || null
              };
            }
          } catch (_) {}
        }
        // Last resort: localStorage snapshot, if any custom key exists
        if (!patient.name && typeof window !== 'undefined') {
          try {
            const ls = JSON.parse(window.localStorage.getItem('patient_profile') || 'null');
            if (ls && typeof ls === 'object') {
              patient = {
                id: ls.patientId || patient.id || null,
                name: ls.name || patient.name || null,
                gender: ls.gender || patient.gender || null,
                age: ls.age || patient.age || null,
                phone: ls.phone || patient.phone || null
              };
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    try {
      // Include any locally added uploads (not yet in storage)
      if (typeof window !== 'undefined') {
        const local = window.localStorage.getItem('uploadedDocuments');
        if (local) {
          try {
            const arr = JSON.parse(local);
            if (Array.isArray(arr)) {
              uploads = uploads.concat(arr.map(f => ({ name: f.name, size: f.size, type: f.type })));
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      if (uid) {
        const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
        const { data } = await supabase.storage.from(bucket).list(uid, { limit: 50 });
        // Append Supabase storage files (names only)
        uploads = uploads.concat((data || []).map(i => ({ name: i.name, size: i?.metadata?.size || null })));
      }
    } catch (_) {}
    return { vitals, uploads, patient };
  };

  const scrollToSection = (id) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startInterview = async () => {
    setILoading(prev => ({ ...prev, start: true }));
    setError('');
    try {
      const ctx = await buildInterviewContext();
      const j = await apiPostJSON('/api/v1/ai/interview/start', { context: ctx });
      if (!j.ok) throw new Error(j?.error || 'Interview start failed');
      setInterview({ sessionId: j.sessionId, question: j.question || '', turns: [], done: Boolean(j.done), report: '' });
      setIAnswer('');
      // reset any previous report
      // ensure previous transcript is cleared too (handled by setting turns: [])
      // Persist immediately
      try { window.localStorage.setItem(LS_KEYS.interview, JSON.stringify({ sessionId: j.sessionId, question: j.question || '', turns: [], done: Boolean(j.done), report: '' })); } catch (_) {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, start: false }));
    }
  };

  const sendInterviewAnswer = async () => {
    if (!interview.sessionId) return;
    const a = String(iAnswer || '').trim();
    if (!a) return;
    setILoading(prev => ({ ...prev, next: true }));
    setError('');
    try {
      const j = await apiPostJSON('/api/v1/ai/interview/next', { sessionId: interview.sessionId, answer: a });
      if (!j.ok) throw new Error(j?.error || 'Interview next failed');
      setInterview(prev => ({
        ...prev,
        question: j.done ? '' : (j.question || ''),
        turns: [...prev.turns, { q: prev.question, a }],
        done: Boolean(j.done),
        report: j.done ? prev.report : ''
      }));
      setIAnswer('');
      // Persist update
      try {
        const nextState = {
          sessionId: interview.sessionId,
          question: j.done ? '' : (j.question || ''),
          turns: [...interview.turns, { q: interview.question, a }],
          done: Boolean(j.done),
          report: j.done ? interview.report : ''
        };
        window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(nextState));
      } catch (_) {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, next: false }));
    }
  };

  const generateInterviewReport = async () => {
    if (!interview.sessionId) return;
    setILoading(prev => ({ ...prev, report: true }));
    setError('');
    try {
      const j = await apiPostJSON('/api/v1/ai/interview/report', { sessionId: interview.sessionId });
      if (!j.ok) throw new Error(j?.error || 'Report failed');
      const reportContent = String(j.report || '');
      setInterview(prev => ({ ...prev, report: reportContent }));
      try {
        const raw = window.localStorage.getItem(LS_KEYS.interview);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.report = reportContent;
        window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(parsed));
      } catch (_) {}

      // Save report to diagnoses table and notify selected doctors
      if (selectedDoctors.length > 0) {
        await saveReportAndNotify(reportContent, { from: 'interview', turns: interview.turns });
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, report: false }));
    }
  };

  const restartInterview = async () => {
    // Reset interview state
    setInterview({ sessionId: null, question: '', turns: [], done: false, report: '' });
    setIAnswer('');
    setError('');
    // Clear localStorage
    try {
      window.localStorage.removeItem(LS_KEYS.interview);
    } catch (_) {}
  };

  const saveReportAndNotify = async (reportContent, metadata = {}) => {
    if (!reportContent || !String(reportContent).trim()) {
      alert('Please generate a report before sharing it with doctors.');
      return;
    }
    if (!selectedDoctors.length) {
      alert('Please select at least one doctor before sharing the report.');
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Save to diagnoses table
      const { data: diagData, error: diagError } = await supabase
        .from('diagnoses')
        .insert([{
          patient_id: user.id,
          content: reportContent,
          severity: 'medium', // Default, can be analyzed
          ai_generated: true,
            metadata: { ...metadata, created_via: 'AIQuestionnairesPage' }
        }])
        .select('id')
        .single();

      if (diagError) throw diagError;

      // Create notifications for selected doctors
      const notifications = selectedDoctors.map(doctorId => ({
        doctor_id: doctorId,
        patient_id: user.id,
        diagnosis_id: diagData.id,
        message: `New AI-generated report available for patient ${user.email || 'Unknown'}`,
        type: 'report_shared',
        is_read: false
      }));

      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notifError) {
        console.warn('Failed to create notifications:', notifError);
        // Don't throw, as report is saved
      }

      alert(`Report saved and shared with ${selectedDoctors.length} doctor(s)!`);
    } catch (e) {
      console.error('Error saving report and notifying doctors:', e);
      alert('Report generated but failed to save/share. Please try again.');
    }
  };

  
  try {
    const interviewStatus = interview.done ? 'Completed' : (interview.sessionId ? 'In Progress' : 'Idle');

    return (
      <div className="aiq-page">
        <section className="card aiq-hero animate-fade-up">
          <div className="aiq-hero-grid">
            <div>
              <p className="aiq-eyebrow">Guided assessments</p>
              <h1 className="aiq-hero-title">AI Health Questionnaires</h1>
              <p className="aiq-hero-subtitle">Adaptive interview and streamlined doctor hand-offs in one workspace.</p>
              <div className="aiq-pill-row">
                <span className={`aiq-pill ${interview.sessionId ? 'aiq-pill-success' : ''}`}>
                  {interview.sessionId ? 'Interview active' : 'Interview idle'}
                </span>
                <span className="aiq-pill">Status: {interviewStatus}</span>
                <span className="aiq-pill">Selected doctors: {selectedDoctors.length}</span>
                <span className="aiq-pill">Turns captured: {interview.turns.length}</span>
                {interview.report && (
                  <span className="aiq-pill aiq-pill-info">Report ready</span>
                )}
              </div>
            </div>
            <div className="aiq-hero-actions">
              <button
                className="btn btn-primary btn-lg"
                onClick={startInterview}
                disabled={iLoading.start}
              >
                {interview.sessionId ? 'Resume Interview' : 'Start Interview'}
              </button>
              <button
                className="btn btn-secondary btn-lg"
                onClick={() => scrollToSection('aiq-interview')}
              >
                Go to Interview Workspace
              </button>
            </div>
          </div>
        </section>

        <div className="aiq-layout">
          <main className="aiq-main">
            <section className="aiq-action-grid">
              <div className="card aiq-action-card">
                <span className="aiq-step-tag">Step 1</span>
                <h3>Adaptive Interview</h3>
                <p>Kick off or resume the conversational intake to surface relevant clinical questions.</p>
                <div className="aiq-action-buttons">
                  <button
                    className="btn btn-primary"
                    onClick={startInterview}
                    disabled={iLoading.start}
                  >
                    {interview.sessionId ? 'Resume Session' : 'Start Interview'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={restartInterview}
                    disabled={!interview.sessionId}
                  >
                    Reset Session
                  </button>
                </div>
                <small className="aiq-hint">{interview.sessionId ? `Session ID: ${interview.sessionId.slice(0, 8)}…` : 'No active session'}</small>
              </div>

              <div className="card aiq-action-card">
                <span className="aiq-step-tag">Step 2</span>
                <h3>Generate Insights</h3>
                <p>Summarize the conversation into a structured clinical briefing for quick review.</p>
                <div className="aiq-action-buttons">
                  <button
                    className="btn btn-primary"
                    onClick={generateInterviewReport}
                    disabled={iLoading.report || !!interview.report || !interview.sessionId}
                  >
                    {iLoading.report ? 'Generating…' : (interview.report ? 'Report Ready' : 'Generate Report')}
                  </button>
                </div>
                <small className="aiq-hint">{interview.report ? 'Report saved locally' : 'Finish the interview to unlock report generation.'}</small>
              </div>

              <div className="card aiq-action-card">
                <span className="aiq-step-tag">Step 3</span>
                <h3>Share Securely</h3>
                <p>Select your care team and notify them once a report is ready.</p>
                <div className="aiq-action-buttons">
                  <button
                    className="btn btn-secondary"
                    onClick={() => saveReportAndNotify(interview.report, { from: 'interview', turns: interview.turns })}
                    disabled={!interview.report || !selectedDoctors.length}
                  >
                    Share with Doctor{selectedDoctors.length > 1 ? 's' : ''}
                  </button>
                </div>
                <small className="aiq-hint">
                  {!selectedDoctors.length ? 'Pick doctors below to enable sharing.' : `${selectedDoctors.length} doctor(s) selected.`}
                </small>
              </div>
            </section>

            <section className="card aiq-doctor-card">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">Care team</p>
                  <h2>Select doctors to notify</h2>
                </div>
                <span className="aiq-pill">{selectedDoctors.length} selected</span>
              </header>
              <p className="muted">Choose the clinicians who should automatically receive updates when you save or share a report.</p>
              {doctors.length > 0 ? (
                <div className="aiq-doctor-grid">
                  {doctors.map((doctor) => {
                    const doctorKey = doctor?.user_id || doctor?.id;
                    const isChecked = doctorKey ? selectedDoctors.includes(doctorKey) : false;
                    return (
                      <label key={doctorKey || (doctor?.email ?? Math.random())} className={`aiq-doctor-card-option ${isChecked ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const doctorId = doctor?.user_id || doctor?.id;
                            if (!doctorId) return;
                            if (e.target.checked) {
                              setSelectedDoctors(prev => Array.from(new Set([...prev, doctorId])));
                            } else {
                              setSelectedDoctors(prev => prev.filter(id => id !== doctorId));
                            }
                          }}
                        />
                        <div>
                          <div className="aiq-doctor-name">{doctor.full_name || doctor.name || 'Doctor'}</div>
                          <div className="muted">{doctor.specialist || doctor.specialty || doctor.specialities || 'General practice'}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="aiq-empty-state">No doctors available right now.</div>
              )}
            </section>

            <section className="card aiq-interview-card" id="aiq-interview">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">Live conversation</p>
                  <h2>Adaptive Interview Workspace</h2>
                </div>
                <span className={`aiq-status-dot ${interview.sessionId ? 'active' : ''}`}>
                  {interview.sessionId ? 'Active' : 'Idle'}
                </span>
              </header>

              {!interview.sessionId ? (
                <div className="aiq-empty-state">
                  <p>Start the guided interview to receive tailored dynamic questions.</p>
                  <button className="btn btn-primary" onClick={startInterview} disabled={iLoading.start}>
                    {iLoading.start ? 'Starting…' : 'Launch Interview'}
                  </button>
                </div>
              ) : (!interview.done ? (
                <>
                  <div className="aiq-question-block">
                    <p className="aiq-label">Current question</p>
                    <h3>{interview.question || 'Waiting for next prompt…'}</h3>
                    <input
                      className="form-input"
                      value={iAnswer}
                      onChange={e => setIAnswer(e.target.value)}
                      placeholder="Type your answer"
                      onKeyDown={(e) => { if (e.key === 'Enter') sendInterviewAnswer(); }}
                    />
                  </div>
                  <div className="aiq-button-row">
                    <button className="btn btn-primary" onClick={sendInterviewAnswer} disabled={iLoading.next || !iAnswer.trim()}>
                      {iLoading.next ? 'Sending…' : 'Send Answer'}
                    </button>
                    <button className="btn btn-secondary" onClick={restartInterview} disabled={iLoading.next || iLoading.report}>
                      Reset Interview
                    </button>
                    <button className="btn btn-secondary" onClick={generateInterviewReport} disabled={iLoading.report}>
                      {iLoading.report ? 'Generating…' : 'Generate Report'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="aiq-empty-state">
                  <p>Interview complete. You can restart any time to capture new insights.</p>
                  <div className="aiq-button-row">
                    <button className="btn btn-secondary" onClick={restartInterview} disabled={iLoading.report}>
                      Start Over
                    </button>
                    <button className="btn btn-primary" onClick={generateInterviewReport} disabled={iLoading.report || !!interview.report}>
                      {iLoading.report ? 'Generating…' : (interview.report ? 'Report Ready' : 'Generate Report')}
                    </button>
                  </div>
                </div>
              ))}

              {interview.turns.length > 0 && (
                <div className="aiq-subcard">
                  <div className="aiq-section-header compact">
                    <h3>Transcript</h3>
                    <span className="aiq-pill">{interview.turns.length} turns</span>
                  </div>
                  <div className="transcript">
                    {interview.turns.map((t, idx) => (
                      <div key={idx} className="aiq-transcript-row">
                        <div><strong>Q{idx + 1}:</strong> {t.q}</div>
                        <div><strong>A{idx + 1}:</strong> {t.a}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="aiq-subcard">
                <div className="aiq-section-header compact">
                  <h3>Interview report</h3>
                  {interview.report && <span className="aiq-pill aiq-pill-success">Ready</span>}
                </div>
                {interview.report ? (
                  <pre className="aiq-report-preview">{interview.report}</pre>
                ) : (
                  <p className="muted">Generate a report once the interview wraps up to archive the summary here.</p>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => saveReportAndNotify(interview.report)}
                  disabled={!interview.report || !selectedDoctors.length}
                >
                  {selectedDoctors.length > 1 ? 'Share with Selected Doctors' : 'Share with Selected Doctor'}
                </button>
              </div>
            </section>

            <section className="card" id="aiq-questionnaires">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">Structured forms</p>
                  <h2>Available Questionnaires</h2>
                </div>
                <div className="aiq-pill-row">
                  <span className="aiq-pill">{questionnaires.length} available</span>
                  <span className="aiq-pill">Avg {Math.round(questionnaires.reduce((sum, q) => sum + (q.estimated_duration || 5), 0) / (questionnaires.length || 1))} min</span>
                </div>
              </header>
              {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}
              {questionnaires.length > 0 ? (
                <div className="aiq-questionnaire-grid">
                  {questionnaires.map((questionnaire) => (
                    <div key={questionnaire.id} className="aiq-questionnaire-card">
                      <div>
                        <h3>{questionnaire.title}</h3>
                        <p>{questionnaire.description}</p>
                      </div>
                      <div className="aiq-questionnaire-meta">
                        <span>{questionnaire.questions?.length || 0} questions</span>
                        <span>~{questionnaire.estimated_duration || 5} min</span>
                      </div>
                      <button className="btn btn-primary" onClick={() => startQuestionnaire(questionnaire)}>
                        Start Questionnaire
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="aiq-empty-state">No questionnaires available at the moment.</div>
              )}
            </section>

            <section className="card aiq-completed-card">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">History</p>
                  <h2>Completed Assessments</h2>
                </div>
                <span className="aiq-pill">{completedQuestionnaires.length} total</span>
              </header>
              {completedQuestionnaires.length > 0 ? (
                <div className="aiq-completed-grid">
                  {completedQuestionnaires.map((response) => {
                    const result = getAssessmentResult({ questions: [] }, response.answers);
                    return (
                      <div key={response.id} className="aiq-completed-card-item">
                        <div>
                          <h3>{response.questionnaire_title}</h3>
                          <p className="muted">Completed {new Date(response.completed_at).toLocaleDateString()}</p>
                        </div>
                        <div className="aiq-completed-status" style={{ backgroundColor: result.color }}>
                          <span>{result.level}</span>
                          <small>{result.advice}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="aiq-empty-state">Complete your first assessment to see history here.</div>
              )}
            </section>

            <div className="aiq-nav">
              <button className="btn btn-secondary" onClick={() => navigate('/assessment/vitals')}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/assessment/documents')}>
                Next
              </button>
            </div>
          </main>

          <aside className="aiq-aside" aria-label="Patient context panel">
            <div className="card aiq-context-card">
              <h3 className="card-title">Patient Context</h3>
              <p className="muted">Demographics, vitals, and uploads feed the AI prompts.</p>

              <div className="aiq-context-group">
                <strong>Demographics</strong>
                <div className="aiq-context-list">
                  <div><span>Name</span><span>{contextData.patient?.name || '—'}</span></div>
                  <div><span>Age</span><span>{contextData.patient?.age ?? '—'}</span></div>
                  <div><span>Gender</span><span>{contextData.patient?.gender || '—'}</span></div>
                  <div><span>Contact</span><span>{contextData.patient?.phone || contextData.patient?.email || '—'}</span></div>
                </div>
              </div>

              <div className="aiq-context-group">
                <strong>Latest Vitals</strong>
                <div className="aiq-context-list">
                  {Array.isArray(contextData.vitals) && contextData.vitals.length > 0 ? (
                    contextData.vitals.map((v, idx) => (
                      <div key={idx}>
                        <span>{v.type}</span>
                        <span>{v.value ?? '—'} {v.unit || ''}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No recent vitals</div>
                  )}
                </div>
              </div>

              <div className="aiq-context-group">
                <strong>Uploaded Documents</strong>
                {Array.isArray(contextData.uploads) && contextData.uploads.length > 0 ? (
                  <ul className="aiq-upload-list">
                    {contextData.uploads.map((u, i) => (
                      <li key={i}>{u.name || u}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="muted">No uploads</div>
                )}
              </div>

              <div className="aiq-button-row">
                <button className="btn btn-light" onClick={refreshContext}>Refresh</button>
                <button className="btn btn-outline" onClick={() => alert('This context will be included in AI prompts.')}>How it’s used</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  } catch (error) {
    console.error('AIQuestionnairesPage: ERROR in main render:', error);
    return (
      <div style={{ padding: '20px', background: 'red', color: 'white', fontSize: '18px' }}>
        🚨 MAIN RENDER ERROR: {error.message}
        <br />
        <pre>{error.stack}</pre>
      </div>
    );
  }
}

export default AIQuestionnairesPage;

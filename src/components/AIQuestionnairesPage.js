
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

  const [questionnaires, setQuestionnaires] = useState([]);
  const [currentQuestionnaire, setCurrentQuestionnaire] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completedQuestionnaires, setCompletedQuestionnaires] = useState([]);
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
    questionnaire: 'questionnaire_progress_v1',
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
    fetchQuestionnaires();
    fetchCompletedQuestionnaires();
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

  const fetchQuestionnaires = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_questionnaires')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      setQuestionnaires(data || []);
    } catch (err) {
      console.error('Error fetching questionnaires:', err);
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
      // Support both historical keys: 'vitalsData' (camel) and 'vitals_data' (snake)
      let raw = null;
      if (typeof window !== 'undefined') {
        raw = window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data');
      }
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        // Normalize to a compact list for prompts
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
      // reset any ongoing questionnaire view when interview starts
      setCurrentQuestionnaire(null);
      setCurrentQuestionIndex(0);
      setAnswers({});
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
        await saveReportAndNotify(reportContent);
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
    // Reset any ongoing questionnaire view
    setCurrentQuestionnaire(null);
    setCurrentQuestionIndex(0);
    setAnswers({});
  };

  const saveReportAndNotify = async (reportContent) => {
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
          metadata: { from: 'interview', turns: interview.turns, created_via: 'AIQuestionnairesPage.generateInterviewReport' }
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

  const fetchCompletedQuestionnaires = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('patient_questionnaire_responses')
        .select('*')
        .eq('user_id', user?.id)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      setCompletedQuestionnaires(data || []);
    } catch (err) {
      console.error('Error fetching completed questionnaires:', err);
    }
  };

  // runHealthCheck removed from UI helpers

  const startQuestionnaire = (questionnaire) => {
    setCurrentQuestionnaire(questionnaire);
    setCurrentQuestionIndex(0);
    setAnswers({});
  };

  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < currentQuestionnaire.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const previousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const submitQuestionnaire = async () => {
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('patient_questionnaire_responses')
        .insert([{
          user_id: user?.id,
          questionnaire_id: currentQuestionnaire.id,
          questionnaire_title: currentQuestionnaire.title,
          answers: answers,
          completed_at: new Date().toISOString()
        }]);

      if (error) throw error;

      // Reset state
      setCurrentQuestionnaire(null);
      setCurrentQuestionIndex(0);
      setAnswers({});
      
      // Refresh completed questionnaires
      await fetchCompletedQuestionnaires();
      
      alert('Questionnaire completed successfully!');
    } catch (err) {
      console.error('Error submitting questionnaire:', err);
      alert('Failed to submit questionnaire. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isQuestionAnswered = (question) => {
    return answers[question.id] !== undefined && answers[question.id] !== '';
  };

  const isQuestionnaireComplete = () => {
    if (!currentQuestionnaire) return false;
    return currentQuestionnaire.questions.every(question => isQuestionAnswered(question));
  };

  const getAssessmentResult = (questionnaire, userAnswers) => {
    // Simple scoring algorithm - can be enhanced based on specific questionnaire needs
    let score = 0;
    let maxScore = 0;
    
    questionnaire.questions.forEach(question => {
      maxScore += question.max_score || 1;
      const answer = userAnswers[question.id];
      
      if (question.type === 'multiple_choice' && question.options) {
        const selectedOption = question.options.find(opt => opt.value === answer);
        if (selectedOption) {
          score += selectedOption.score || 1;
        }
      } else if (question.type === 'scale' && answer) {
        score += parseInt(answer);
      } else if (answer) {
        score += 1;
      }
    });

    const percentage = (score / maxScore) * 100;
    
    if (percentage >= 80) return { level: 'Low Risk', color: '#28a745', advice: 'Continue maintaining your current health status.' };
    if (percentage >= 60) return { level: 'Moderate Risk', color: '#ffc107', advice: 'Consider consulting with a healthcare provider for further evaluation.' };
    return { level: 'High Risk', color: '#dc3545', advice: 'Please seek medical attention promptly.' };
  };

  const renderQuestion = (question) => {
    const currentAnswer = answers[question.id];

    switch (question.type) {
      case 'multiple_choice':
        return (
          <div className="question-options">
            {question.options.map((option, index) => (
              <label key={index} className="option-label">
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option.value}
                  checked={currentAnswer === option.value}
                  onChange={() => handleAnswerChange(question.id, option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        );

      case 'scale':
        return (
          <div className="scale-question">
            <div className="scale-range">
              <span>{question.scale_min || 0}</span>
              <input
                type="range"
                min={question.scale_min || 0}
                max={question.scale_max || 10}
                value={currentAnswer || (question.scale_min || 0)}
                onChange={(e) => handleAnswerChange(question.id, e.target.value)}
              />
              <span>{question.scale_max || 10}</span>
            </div>
            <div className="scale-value">
              Current value: {currentAnswer || (question.scale_min || 0)}
            </div>
          </div>
        );

      case 'text':
        return (
          <textarea
            value={currentAnswer || ''}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Please provide your answer..."
            rows={4}
          />
        );

      case 'yes_no':
        return (
          <div className="yes-no-options">
            <label className="option-label">
              <input
                type="radio"
                name={`question-${question.id}`}
                value="yes"
                checked={currentAnswer === 'yes'}
                onChange={() => handleAnswerChange(question.id, 'yes')}
              />
              Yes
            </label>
            <label className="option-label">
              <input
                type="radio"
                name={`question-${question.id}`}
                value="no"
                checked={currentAnswer === 'no'}
                onChange={() => handleAnswerChange(question.id, 'no')}
              />
              No
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  if (currentQuestionnaire) {
    const currentQuestion = currentQuestionnaire.questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / currentQuestionnaire.questions.length) * 100;

    try {
    return (
      <div className="questionnaire-container">
        <div className="questionnaire-content">
          <div className="questionnaire-header">
            <h2>{currentQuestionnaire.title}</h2>
            <p>{currentQuestionnaire.description}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="progress-text">
              Question {currentQuestionIndex + 1} of {currentQuestionnaire.questions.length}
            </p>
          </div>

          <div className="question-section">
            <h3>{currentQuestion.text}</h3>
            {currentQuestion.subtext && (
              <p className="question-subtext">{currentQuestion.subtext}</p>
            )}
            {renderQuestion(currentQuestion)}
          </div>

          <div className="question-navigation">
            <button
              className="btn-secondary"
              onClick={previousQuestion}
              disabled={currentQuestionIndex === 0}
            >
              Previous
            </button>
            
            {currentQuestionIndex < currentQuestionnaire.questions.length - 1 ? (
              <button
                className="btn-primary"
                onClick={nextQuestion}
                disabled={!isQuestionAnswered(currentQuestion)}
              >
                Next
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={submitQuestionnaire}
                disabled={!isQuestionnaireComplete() || submitting}
              >
                {submitting ? 'Submitting...' : 'Complete Questionnaire'}
              </button>
            )}
            
            <button
              className="btn-secondary"
              onClick={() => setCurrentQuestionnaire(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
    } catch (error) {
      console.error('AIQuestionnairesPage: ERROR in questionnaire render:', error);
      return (
        <div style={{ padding: '20px', background: 'red', color: 'white', fontSize: '18px' }}>
          🚨 QUESTIONNAIRE RENDER ERROR: {error.message}
          <br />
          <pre>{error.stack}</pre>
        </div>
      );
    }
  }

  

  try {
    return (
      <div className="ai-questionnaires-container">
        <section className="hero animate-fade-up">
          <h1 className="hero-title">AI Health Questionnaires</h1>
          <p className="hero-subtitle">Adaptive interview and intelligent forms to tailor insights to your condition.</p>
          <div className="hero-cta" style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={startInterview}
              disabled={iLoading.start || selectedDoctors.length === 0}
              title={selectedDoctors.length === 0 ? "Please select at least one doctor first" : "Start Interview"}
              style={{ padding: '12px 28px' }}
            >
              {iLoading.start ? 'Starting…' : 'Start Interview'}
            </button>
          </div>
        </section>

        <div className="ai-questionnaires-content">
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 1200, margin: '0 auto', padding: 20, flexWrap: 'wrap' }}>

            {/* Left/main column */}
            <main style={{ flex: 1, minWidth: 0 }}>
              <div style={{ maxWidth: 980, margin: '0', paddingRight: 12 }}>

                <p>Complete intelligent health assessments to get personalized insights about your well‑being.</p>

                {/* Doctor Selection Section */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <h3 className="card-title">Select Doctors to Share Report With</h3>
                  <p className="muted">Choose which doctors should receive your AI-generated health report after the assessment.</p>
                  {doctors.length > 0 ? (
                    <div className="doctor-selection-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px', marginTop: '12px' }}>
                      {doctors.map(doctor => (
                        <label key={doctor.id || doctor.user_id} className="doctor-option" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', background: selectedDoctors.includes(doctor.id || doctor.user_id) ? '#f0f8ff' : 'transparent' }}>
                          <input
                            type="checkbox"
                            checked={selectedDoctors.includes(doctor.id || doctor.user_id)}
                            onChange={(e) => {
                              const doctorId = doctor.id || doctor.user_id;
                              if (e.target.checked) {
                                setSelectedDoctors(prev => [...prev, doctorId]);
                              } else {
                                setSelectedDoctors(prev => prev.filter(id => id !== doctorId));
                              }
                            }}
                          />
                          <div>
                            <div style={{ fontWeight: '500' }}>{doctor.full_name || doctor.name || 'Doctor'}</div>
                            <div className="muted" style={{ fontSize: '12px' }}>{doctor.specialist || doctor.specialty || doctor.specialities || 'General'}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No doctors available at the moment.</p>
                  )}
                  {selectedDoctors.length > 0 && (
                    <div style={{ marginTop: '12px', fontSize: '14px' }}>
                      <strong>Selected: {selectedDoctors.length} doctor(s)</strong>
                    </div>
                  )}
                </div>

                <div className="questionnaires-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: 12, flexWrap: 'wrap' }}>
                    <h2>Available Questionnaires</h2>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary"
                        onClick={startInterview}
                        disabled={iLoading.start}
                        title="Start Interview"
                      >
                        {iLoading.start ? 'Starting…' : 'Start Interview'}
                      </button>
                    </div>
                  </div>
                  {error && <div className="alert alert-danger" style={{ marginBottom: '20px' }}>{error}</div>}

                  {interview.sessionId && (
                    <div className="card" style={{ marginBottom: 20 }}>
                      {!interview.done ? (
                        <>
                          <h3 className="card-title">Interview</h3>
                          <p style={{ fontSize: 18 }}>{interview.question || '…'}</p>
                          <div className="form-group">
                            <input
                              className="form-input"
                              value={iAnswer}
                              onChange={e => setIAnswer(e.target.value)}
                              placeholder="Type your answer"
                              onKeyDown={(e) => { if (e.key === 'Enter') sendInterviewAnswer(); }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-primary" onClick={sendInterviewAnswer} disabled={iLoading.next || !iAnswer.trim()}>
                              {iLoading.next ? 'Sending…' : 'Send Answer'}
                            </button>
                            <button className="btn btn-secondary" onClick={generateInterviewReport} disabled={iLoading.report} title="Finish now and generate a report">
                              {iLoading.report ? 'Generating…' : 'Finish & Generate Report'}
                            </button>
                            <button className="btn btn-light" onClick={restartInterview} disabled={iLoading.next || iLoading.report}>
                              Start Over
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="card-title">Interview Complete</h3>
                          <p className="muted">You can switch to other sections now.</p>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-primary" onClick={generateInterviewReport} disabled={iLoading.report || !!interview.report}>
                              {iLoading.report ? 'Generating…' : (interview.report ? 'Report Ready' : 'Generate Report')}
                            </button>
                            <button className="btn btn-light" onClick={restartInterview} disabled={iLoading.report}>
                              Start Over
                            </button>
                          </div>
                        </>
                      )}
                      {interview.turns.length > 0 && (
                        <div className="card" style={{ marginTop: 16 }}>
                          <h3 className="card-title">Transcript</h3>
                          <div className="transcript">
                            {interview.turns.map((t, idx) => (
                              <div key={idx} style={{ marginBottom: 8 }}>
                                <div><strong>Q{idx + 1}:</strong> {t.q}</div>
                                <div><strong>A{idx + 1}:</strong> {t.a}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {interview.report ? (
                        <div className="card" style={{ marginTop: 16 }}>
                          <h3 className="card-title">Interview Report</h3>
                          <pre style={{ whiteSpace: 'pre-wrap', background: '#f9f9f9', padding: 12, borderRadius: 6 }}>
                            {interview.report}
                          </pre>
                          {selectedDoctors.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <button className="btn btn-secondary" onClick={() => saveReportAndNotify(interview.report)}>
                                Share with Doctor
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {questionnaires.length > 0 ? (
                    <div className="questionnaires-grid">
                      {questionnaires.map((questionnaire) => (
                        <div key={questionnaire.id} className="questionnaire-card">
                          <div className="questionnaire-info">
                            <h3>{questionnaire.title}</h3>
                            <p>{questionnaire.description}</p>
                            <div className="questionnaire-meta">
                              <span className="question-count">
                                {questionnaire.questions?.length || 0} questions
                              </span>
                              <span className="estimated-time">
                                ~{questionnaire.estimated_duration || 5} min
                              </span>
                            </div>
                          </div>
                          <div className="questionnaire-actions">
                            <button
                              className="btn btn-primary"
                              onClick={() => startQuestionnaire(questionnaire)}
                            >
                              Start Questionnaire
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="no-data">No questionnaires available at the moment. Click "Generate New Questionnaire" to create one with AI.</p>
                  )}

                </div>

                <div className="completed-section">
                  <h2>Completed Assessments</h2>
                  {completedQuestionnaires.length > 0 ? (
                    <div className="completed-grid">
                      {completedQuestionnaires.map((response) => {
                        const result = getAssessmentResult(
                          { questions: [] }, // In real app, fetch full questionnaire
                          response.answers
                        );
                        
                        return (
                          <div key={response.id} className="completed-card">
                            <div className="completed-info">
                              <h3>{response.questionnaire_title}</h3>
                              <p className="completion-date">
                                Completed: {new Date(response.completed_at).toLocaleDateString()}
                              </p>
                              <div className="assessment-result" style={{ backgroundColor: result.color }}>
                                <span className="result-level">{result.level}</span>
                              </div>
                              <p className="result-advice">{result.advice}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="no-data">No completed questionnaires yet.</p>
                  )}
                </div>

                <div className="back-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => navigate('/assessment/vitals')}
                  >
                    Back
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => navigate('/assessment/documents')}
                  >
                    Next
                  </button>
                </div>

              </div>
            </main>

            {/* Right/context column */}
            <aside style={{ width: 320, flexShrink: 0 }} aria-label="Patient context panel">
              <div className="card" style={{ position: 'sticky', top: 20 }}>
                <h3 className="card-title">Patient Context</h3>
                <p className="muted" style={{ marginBottom: 12 }}>Quick view: demographics, recent vitals, and uploads will be included in AI context.</p>

                <div style={{ marginBottom: 12 }}>
                  <strong>Demographics</strong>
                  <div style={{ marginTop: 8 }}>
                    <div><strong>Name:</strong> {contextData.patient?.name || '—'}</div>
                    <div><strong>Age:</strong> {contextData.patient?.age ?? '—'}</div>
                    <div><strong>Gender:</strong> {contextData.patient?.gender || '—'}</div>
                    <div><strong>Contact:</strong> {contextData.patient?.phone || contextData.patient?.email || '—'}</div>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>Latest Vitals</strong>
                  <div style={{ marginTop: 8 }}>
                    {Array.isArray(contextData.vitals) && contextData.vitals.length > 0 ? (
                      contextData.vitals.map((v, idx) => (
                        <div key={idx} style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 13 }}><strong>{v.type}</strong>: {v.value ?? '—'} {v.unit || ''}</div>
                          {v.timestamp && <div style={{ fontSize: 11, color: '#666' }}>{new Date(v.timestamp).toLocaleString()}</div>}
                        </div>
                      ))
                    ) : (
                      <div className="muted">No recent vitals</div>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>Uploaded Documents</strong>
                  <div style={{ marginTop: 8 }}>
                    {Array.isArray(contextData.uploads) && contextData.uploads.length > 0 ? (
                      <ul style={{ paddingLeft: 16, margin: 0 }}>
                        {contextData.uploads.map((u, i) => (
                          <li key={i} style={{ fontSize: 13, marginBottom: 6 }}>{u.name || u}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">No uploads</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-light" onClick={refreshContext}>Refresh</button>
                  <button className="btn btn-outline" onClick={() => alert('This context will be included in AI prompts.')}>How it’s used</button>
                </div>
              </div>
            </aside>

          </div>
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

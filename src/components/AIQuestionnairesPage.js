import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabaseClient';
import './aiq.css';

// Version stamp to help verify which build is running in the browser
try {
  // eslint-disable-next-line no-console
  console.log('AIQuestionnairesPage loaded - buildStamp:', '%s', new Date().toISOString());
} catch (_) {}

const MAX_VISIBLE_DOCTORS = 6;

const LS_KEYS = {
  interview: 'aiq_interview_state_v2',
  selectedDoctors: 'aiq_selected_doctors_v2',
  context: 'aiq_context_snapshot_v1',
  base: 'aiq_server_base_v1',
  language: 'aiq_interview_language_v1'
};

const initialInterviewState = { sessionId: null, question: '', turns: [], done: false, report: '' };
const initialContextState = { patient: {}, vitals: [], uploads: [] };
const PATIENT_COLUMNS = 'id,user_id,full_name,name,email,phone,address,date_of_birth,age,gender';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUUID = (value) => {
  if (!value) return false;
  const str = String(value).trim();
  return UUID_REGEX.test(str);
};

const resolveDoctorId = (raw, lookupMap) => {
  if (!raw) return null;
  const direct = lookupMap.get(raw);
  if (direct) return direct;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return lookupMap.get(trimmed) || lookupMap.get(trimmed.toLowerCase()) || null;
  }
  return null;
};


const sanitizeBase = (base) => (base || '').replace(/\/$/, '');

const getStoredJSON = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

const getInitialServerBase = () => {
  const env = sanitizeBase(process.env.REACT_APP_SERVER_BASE || '');
  if (env) return env;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(LS_KEYS.base);
    if (stored) return sanitizeBase(stored);
  }
  return '';
};

const truncate = (str = '', len = 240) => {
  if (!str) return '';
  return str.length > len ? `${str.slice(0, len)}…` : str;
};

const formatContextSummary = (ctx) => {
  if (!ctx) return '';
  const lines = [];
  if (ctx.patient && (ctx.patient.name || ctx.patient.age || ctx.patient.gender)) {
    lines.push(
      `Patient: ${ctx.patient.name || 'Unknown'} | Age: ${ctx.patient.age ?? 'n/a'} | Gender: ${ctx.patient.gender || 'n/a'}`
    );
  }
  if (Array.isArray(ctx.vitals) && ctx.vitals.length > 0) {
    const vitalsLine = ctx.vitals
      .slice(0, 5)
      .map((v) => {
        const label = v.type || v.label || 'Vital';
        const value = v.value ?? 'n/a';
        const unit = v.unit ? ` ${v.unit}` : '';
        return `${label}: ${value}${unit}`;
      })
      .join('; ');
    lines.push(`Recent vitals: ${vitalsLine}`);
  }
  if (Array.isArray(ctx.uploads) && ctx.uploads.length > 0) {
    const uploadSnippets = ctx.uploads
      .slice(0, 3)
      .map((doc) => {
        const label = doc.name || doc.title || 'Document';
        const summary = truncate(doc.summary || doc.extractedText || '', 140);
        return summary ? `${label}: ${summary}` : label;
      });
    lines.push(`Recent documents: ${uploadSnippets.join(' | ')}`);
  }
  return lines.join('\n');
};

const loadInitialInterview = () => {
  const cached = getStoredJSON(LS_KEYS.interview, null);
  if (!cached || typeof cached !== 'object') return initialInterviewState;
  return {
    sessionId: cached.sessionId || null,
    question: cached.question || '',
    turns: Array.isArray(cached.turns) ? cached.turns : [],
    done: Boolean(cached.done),
    report: cached.report ? String(cached.report) : ''
  };
};

const loadInitialContext = () => {
  const cached = getStoredJSON(LS_KEYS.context, null);
  if (!cached || typeof cached !== 'object') return initialContextState;
  return {
    patient: cached.patient || initialContextState.patient,
    vitals: Array.isArray(cached.vitals) ? cached.vitals : initialContextState.vitals,
    uploads: Array.isArray(cached.uploads) ? cached.uploads : initialContextState.uploads
  };
};

const loadInitialSelectedDoctors = () => {
  const cached = getStoredJSON(LS_KEYS.selectedDoctors, []);
  return Array.isArray(cached) ? cached : [];
};

const computeAgeFromDob = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

const normalizeDob = (row = {}) => row.date_of_birth || row.dob || row.birth_date || row.birthdate || '';
const normalizePhone = (row = {}) => row.phone || row.contact || row.contact_number || row.phone_number || row.mobile || '';

const mapPatientRowToContext = (row, fallback = {}) => {
  if (!row) return { ...fallback };
  const normalizedDob = normalizeDob(row);
  const normalizedAge = row.age ?? row.patient_age ?? computeAgeFromDob(normalizedDob);
  return {
    ...fallback,
    id: fallback.id || row.user_id || row.patient_id || row.id || null,
    patientId: fallback.patientId || row.patient_id || row.id || null,
    name: row.full_name || row.name || fallback.name || null,
    gender: row.gender || fallback.gender || null,
    age: normalizedAge ?? fallback.age ?? null,
    phone: normalizePhone(row) || fallback.phone || null,
    email: row.email || fallback.email || null,
    dob: normalizedDob || fallback.dob || null
  };
};

function AIQuestionnairesPage() {
  const navigate = useNavigate();
  const [serverBase, setServerBase] = useState(getInitialServerBase);
  const [interview, setInterview] = useState(loadInitialInterview);
  const [iAnswer, setIAnswer] = useState('');
  const [iLoading, setILoading] = useState({ start: false, next: false, report: false });
  const [reportExpanded, setReportExpanded] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [doctorSearch, setDoctorSearch] = useState('');
  const [selectedDoctors, setSelectedDoctors] = useState(loadInitialSelectedDoctors);
  const [contextData, setContextData] = useState(loadInitialContext);
  const [contextLoading, setContextLoading] = useState(false);
  const [staleSelections, setStaleSelections] = useState([]);
  const [error, setError] = useState('');
  const [interviewLanguage, setInterviewLanguage] = useState(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = window.localStorage.getItem(LS_KEYS.language);
    return stored === 'bn' ? 'bn' : 'en';
  });

  const doctorIdentityMap = useMemo(() => {
    const map = new Map();
    (doctors || []).forEach((doc) => {
      if (!doc) return;
      if (doc.id) {
        map.set(doc.id, doc.id);
      }
      if (doc.user_id) {
        map.set(doc.user_id, doc.id);
      }
      if (doc.email) {
        map.set(doc.email, doc.id);
        map.set(doc.email.toLowerCase(), doc.id);
      }
    });
    return map;
  }, [doctors]);

  const doctorIdSet = useMemo(() => {
    const ids = new Set();
    (doctors || []).forEach((doc) => {
      if (doc?.id) ids.add(doc.id);
    });
    return ids;
  }, [doctors]);

  const persistInterview = useCallback((next) => {
    try {
      window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(next));
    } catch (_) {}
  }, []);

  const persistContext = useCallback((next) => {
    try {
      window.localStorage.setItem(LS_KEYS.context, JSON.stringify(next));
    } catch (_) {}
  }, []);

  const fetchPatientRecord = useCallback(async (authUser) => {
    if (!authUser?.id) return null;

    const tryFetch = async (column, value) => {
      try {
        const { data, error } = await supabase
          .from('patients')
          .select(PATIENT_COLUMNS)
          .eq(column, value)
          .maybeSingle();
        if (error) {
          if (error.code !== 'PGRST116') {
            console.warn(`patients fetch by ${column} failed:`, error.message || error);
          }
          return null;
        }
        return data || null;
      } catch (fetchErr) {
        console.warn(`patients fetch by ${column} exception:`, fetchErr?.message || fetchErr);
        return null;
      }
    };

    let row = await tryFetch('user_id', authUser.id);
    if (!row && authUser.email) {
      row = await tryFetch('email', authUser.email);
    }
    if (!row) {
      try {
        const { data, error } = await supabase.rpc('get_patient_profile_for_current_user');
        if (error) {
          console.warn('RPC get_patient_profile_for_current_user failed:', error.message || error);
        } else if (Array.isArray(data) && data.length) {
          row = data[0];
        }
      } catch (rpcErr) {
        console.warn('RPC get_patient_profile_for_current_user exception:', rpcErr?.message || rpcErr);
      }
    }

    if (row && !row.user_id) {
      try {
        await supabase
          .from('patients')
          .update({ user_id: authUser.id })
          .eq('id', row.id);
        row.user_id = authUser.id;
      } catch (linkErr) {
        console.warn('Failed to link patient row to user_id:', linkErr?.message || linkErr);
      }
    }

    return row;
  }, []);

  const apiPostJSON = useCallback(
    async (path, body = {}) => {
      const attempt = async (base) => {
        const prefix = sanitizeBase(base);
        const url = `${prefix}${path}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const raw = await resp.text();
        let json;
        try {
          json = JSON.parse(raw);
        } catch (_) {
          throw new Error(`Backend did not return JSON (status ${resp.status}).`);
        }
        if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
        if (json && json.ok === false) throw new Error(json?.error || 'Request failed');
        return json;
      };
      try {
        return await attempt(serverBase || '');
      } catch (primaryError) {
        if (!serverBase || serverBase !== 'http://localhost:5001') {
          const fallbackBase = 'http://localhost:5001';
          const json = await attempt(fallbackBase);
          setServerBase(fallbackBase);
          try {
            window.localStorage.setItem(LS_KEYS.base, fallbackBase);
          } catch (_) {}
          return json;
        }
        throw primaryError;
      }
    },
    [serverBase]
  );

  const fetchDoctors = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('doctors')
        .select('id, user_id, name, email, specialty, bio, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setDoctors(data || []);
      setError('');
    } catch (fetchError) {
      console.error('Failed to fetch doctors', fetchError);
      setError('Unable to load doctors right now. Please refresh later.');
    }
  }, []);

  const buildInterviewContext = useCallback(async () => {
    const snapshot = { patient: {}, vitals: [], uploads: [] };
    if (typeof window !== 'undefined') {
      try {
        const vitalsRaw = window.localStorage.getItem('vitals_data');
        if (vitalsRaw) {
          const parsed = JSON.parse(vitalsRaw);
          if (Array.isArray(parsed) && parsed.length > 0) snapshot.vitals = [parsed[parsed.length - 1]];
        }
      } catch (_) {}
      try {
        const patientRaw = window.localStorage.getItem('patient_profile');
        if (patientRaw) {
          const parsed = JSON.parse(patientRaw);
          if (parsed && typeof parsed === 'object') {
            snapshot.patient = {
              id: parsed.patientId || parsed.id || snapshot.patient.id || null,
              name: parsed.name || parsed.full_name || snapshot.patient.name || null,
              gender: parsed.gender || snapshot.patient.gender || null,
              age: parsed.age ?? snapshot.patient.age ?? null,
              phone: parsed.phone || snapshot.patient.phone || null,
              email: parsed.email || snapshot.patient.email || null
            };
          }
        }
      } catch (_) {}
      try {
        const uploadsRaw = window.localStorage.getItem('uploadedDocuments');
        if (uploadsRaw) {
          const parsed = JSON.parse(uploadsRaw);
          if (Array.isArray(parsed)) {
            snapshot.uploads = snapshot.uploads.concat(
              parsed.map((file) => ({ name: file.name, size: file.size, type: file.type }))
            );
          }
        }
      } catch (_) {}
    }
    try {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      const uid = authUser?.id;
      if (uid) {
        try {
          const { data: docs, error: docsError } = await supabase
            .from('documents')
            .select('*')
            .eq('user_id', uid)
            .order('uploaded_at', { ascending: false })
            .limit(1);
          if (docsError) throw docsError;
          if (Array.isArray(docs) && docs.length) {
            snapshot.uploads = docs.map((doc) => ({
              id: doc.id,
              name: doc.original_name || doc.file_name || 'Document',
              type: doc.mime_type || '',
              size: doc.size_bytes || null,
              url: doc.public_url || null,
              uploadedAt: doc.uploaded_at || null,
              status: doc.extraction_status || 'pending',
              summary: doc.extraction_summary || null,
              extractedText: doc.extracted_text || null
            }));
          }
        } catch (documentsError) {
          console.warn('Failed to fetch document metadata from table:', documentsError);
          if (snapshot.uploads.length === 0) {
            const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
            try {
              const { data } = await supabase.storage.from(bucket).list(uid, { limit: 25 });
              if (Array.isArray(data)) {
                snapshot.uploads = data.map((item) => ({
                  name: item.name,
                  size: item?.metadata?.size || null,
                  type: item?.metadata?.mimetype || item?.metadata?.type || null
                }));
              }
            } catch (storageError) {
              console.warn('Storage listing fallback failed:', storageError);
            }
          }
        }

        const patientRow = await fetchPatientRecord(authUser);
        if (patientRow) {
          snapshot.patient = mapPatientRowToContext(patientRow, snapshot.patient);
        }

        snapshot.patient = {
          ...snapshot.patient,
          id: snapshot.patient.id || uid,
          email: snapshot.patient.email || authUser.email
        };
      }
    } catch (ctxErr) {
      console.warn('Failed to extend context from Supabase', ctxErr);
    }
    return snapshot;
  }, [fetchPatientRecord]);

  const refreshContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const next = await buildInterviewContext();
      setContextData(next);
      persistContext(next);
    } catch (ctxErr) {
      console.error('Failed to refresh context', ctxErr);
    } finally {
      setContextLoading(false);
    }
  }, [buildInterviewContext, persistContext]);

  const scrollToSection = (id) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startInterview = async () => {
    setILoading((prev) => ({ ...prev, start: true }));
    setError('');
    try {
      const ctx = await buildInterviewContext();
      setContextData(ctx);
      persistContext(ctx);
      const response = await apiPostJSON('/api/v1/ai/interview/start', {
        context: ctx,
        language: interviewLanguage
      });
      const nextState = { sessionId: response.sessionId, question: response.question || '', turns: [], done: Boolean(response.done), report: '' };
      setInterview(nextState);
      persistInterview(nextState);
      setIAnswer('');
    } catch (startError) {
      setError(startError.message || String(startError));
    } finally {
      setILoading((prev) => ({ ...prev, start: false }));
    }
  };

  const sendInterviewAnswer = async () => {
    if (!interview.sessionId) return;
    const trimmed = iAnswer.trim();
    if (!trimmed) return;
    setILoading((prev) => ({ ...prev, next: true }));
    setError('');
    try {
      const response = await apiPostJSON('/api/v1/ai/interview/next', {
        sessionId: interview.sessionId,
        answer: trimmed,
        language: interviewLanguage
      });
      setInterview((prev) => {
        const nextTurns = [...prev.turns, { q: prev.question, a: trimmed }];
        const nextState = {
          sessionId: prev.sessionId,
          question: response.done ? '' : response.question || '',
          turns: nextTurns,
          done: Boolean(response.done),
          report: response.done ? prev.report : ''
        };
        persistInterview(nextState);
        return nextState;
      });
      setIAnswer('');
    } catch (answerError) {
      setError(answerError.message || String(answerError));
    } finally {
      setILoading((prev) => ({ ...prev, next: false }));
    }
  };

  const restartInterview = () => {
    setInterview(initialInterviewState);
    setIAnswer('');
    setError('');
    try {
      window.localStorage.removeItem(LS_KEYS.interview);
    } catch (_) {}
  };

  const saveReportAndNotify = useCallback(
    async (reportContent, metadata = {}) => {
      if (!reportContent || !String(reportContent).trim()) {
        alert('Please generate a report before sharing it with doctors.');
        return;
      }
      if (!selectedDoctors.length) {
        alert('Please select at least one doctor before sharing the report.');
        return;
      }
      const shareableDoctorIds = selectedDoctors.filter((doctorId) => doctorIdSet.has(doctorId));
      if (!shareableDoctorIds.length) {
        alert('Selected doctors are no longer available. Please re-select from the latest list before sharing.');
        return;
      }
      if (shareableDoctorIds.length < selectedDoctors.length) {
        console.warn('One or more selected doctors were skipped because their profiles are unavailable.');
      }
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) throw new Error('User not authenticated');
        const { data: diagData, error: diagError } = await supabase
          .from('diagnoses')
          .insert([
            {
              patient_id: user.id,
              content: reportContent,
              severity: 'medium',
              ai_generated: true,
              metadata: { ...metadata, created_via: 'AIQuestionnairesPage', language: interviewLanguage }
            }
          ])
          .select('id')
          .single();
        if (diagError) throw diagError;
        const notifications = shareableDoctorIds.map((doctorId) => ({
          doctor_id: doctorId,
          patient_id: user.id,
          diagnosis_id: diagData.id,
          message: `New AI-generated report available for patient ${user.email || 'Unknown'}`,
          type: 'report_shared',
          is_read: false
        }));
        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        const numShared = shareableDoctorIds.length;
        if (notifError) console.warn('Failed to create notifications:', notifError);
        let alertMessage = `Report saved and shared with ${numShared} doctor(s)!`;
        if (numShared < selectedDoctors.length) {
          alertMessage += `\n\nNote: ${selectedDoctors.length - numShared} previously selected doctor(s) were unavailable and not notified.`;
        }
        alert(alertMessage);
      } catch (shareError) {
        console.error('Error saving report and notifying doctors:', shareError);
        alert('Report generated but failed to save/share. Please try again.');
      }
    },
    [selectedDoctors, interviewLanguage, doctorIdSet]
  );

  const generateInterviewReport = async () => {
    if (!interview.sessionId) return;
    setILoading((prev) => ({ ...prev, report: true }));
    setError('');
    try {
      const response = await apiPostJSON('/api/v1/ai/interview/report', {
        sessionId: interview.sessionId,
        language: interviewLanguage
      });
      const reportContent = String(response.report || '');
      const summary = formatContextSummary(contextData);
      const enrichedReport = summary ? `${reportContent}\n\n---\n${summary}` : reportContent;
      setInterview((prev) => {
        const nextState = { ...prev, report: enrichedReport };
        persistInterview(nextState);
        return nextState;
      });
      // Auto-expand when a report is generated
      setReportExpanded(true);
      if (selectedDoctors.length > 0) {
        await saveReportAndNotify(enrichedReport, { from: 'interview', turns: interview.turns, context: contextData });
      }
    } catch (reportError) {
      setError(reportError.message || String(reportError));
    } finally {
      setILoading((prev) => ({ ...prev, report: false }));
    }
  };

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  // If a report already exists (e.g., from localStorage), auto-expand it so users see full content
  useEffect(() => {
    if (interview && interview.report) {
      setReportExpanded(true);
    }
  }, [interview?.report]);

  useEffect(() => {
    setSelectedDoctors((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      const normalized = [];
      const stale = [];
      prev.forEach((value) => {
        const resolved = resolveDoctorId(value, doctorIdentityMap);
        if (resolved) {
          if (!normalized.includes(resolved)) normalized.push(resolved);
          return;
        }
        if (isValidUUID(value)) {
          const trimmed = String(value).trim();
          if (!normalized.includes(trimmed)) {
            stale.push(trimmed);
          }
        }
      });
      if (stale.length > 0) {
        setStaleSelections(stale);
      }
      if (normalized.length === prev.length && normalized.every((val, idx) => val === prev[idx])) {
        return prev;
      }
      return normalized;
    });
  }, [doctorIdentityMap]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEYS.selectedDoctors, JSON.stringify(selectedDoctors));
    } catch (_) {}
  }, [selectedDoctors]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEYS.language, interviewLanguage);
    } catch (_) {}
  }, [interviewLanguage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEYS.base, serverBase || '');
    } catch (_) {}
  }, [serverBase]);

  const availableDoctorCount = useMemo(() => {
    if (!Array.isArray(selectedDoctors) || selectedDoctors.length === 0) return 0;
    if (!doctorIdSet.size) return 0;
    return selectedDoctors.filter((id) => doctorIdSet.has(id)).length;
  }, [selectedDoctors, doctorIdSet]);
  const hasUnavailableSelections = selectedDoctors.length > 0 && availableDoctorCount < selectedDoctors.length;
  const interviewStatus = interview.done ? 'Completed' : interview.sessionId ? 'In Progress' : 'Idle';
  const languageLabel = interviewLanguage === 'bn' ? 'Bangla' : 'English';
  const normalizedQuery = doctorSearch.trim().toLowerCase();
  const matchingDoctors = normalizedQuery
    ? doctors.filter((doc) => {
        const name = String(doc?.full_name || doc?.name || '').toLowerCase();
        const specialty = String(doc?.specialty || doc?.specialist || doc?.bio || '').toLowerCase();
        return name.includes(normalizedQuery) || specialty.includes(normalizedQuery);
      })
    : doctors;
  const initialDoctorList = normalizedQuery ? matchingDoctors : doctors.slice(0, MAX_VISIBLE_DOCTORS);
  const selectedSupplements = !normalizedQuery
    ? doctors.filter((doc) => {
        const key = doc?.id;
        if (!key) return false;
        return selectedDoctors.includes(key) && !initialDoctorList.some((d) => d?.id === key);
      })
    : [];
  const displayedDoctors = normalizedQuery ? initialDoctorList : [...initialDoctorList, ...selectedSupplements];
  const noDoctorMatches = normalizedQuery && displayedDoctors.length === 0;
  const shareDisabled = !interview.report || availableDoctorCount === 0;

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
              <span className="aiq-pill">Selected doctors: {availableDoctorCount}</span>
              <span className="aiq-pill">Turns captured: {interview.turns.length}</span>
              <span className="aiq-pill">Language: {languageLabel}</span>
              {interview.report && <span className="aiq-pill aiq-pill-info">Report ready</span>}
            </div>
          </div>
          <div className="aiq-hero-actions">
            <button className="btn btn-primary btn-lg" onClick={startInterview} disabled={iLoading.start}>
              {interview.sessionId ? 'Resume Interview' : 'Start Interview'}
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => scrollToSection('aiq-interview')}>
              Go to Interview Workspace
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => navigate('/patient/documents')}>
              View Documents
            </button>
            <div className="aiq-language-switch">
              <label htmlFor="interview-language" className="aiq-label" style={{ marginBottom: 4 }}>
                Interview language
              </label>
              <select
                id="interview-language"
                className="form-input"
                value={interviewLanguage}
                onChange={(e) => setInterviewLanguage(e.target.value === 'bn' ? 'bn' : 'en')}
              >
                <option value="en">English</option>
                <option value="bn">Bangla</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div className="aiq-layout">
        <main className="aiq-main-grid">
          <div className="aiq-primary-stack">
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
              ) : !interview.done ? (
                <>
                  <div className="aiq-question-block">
                    <p className="aiq-label">Current question</p>
                    <h3>{interview.question || 'Waiting for next prompt…'}</h3>
                    <input
                      className="form-input"
                      value={iAnswer}
                      onChange={(e) => setIAnswer(e.target.value)}
                      placeholder="Type your answer"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') sendInterviewAnswer();
                      }}
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
                      {iLoading.report ? 'Generating…' : interview.report ? 'Report Ready' : 'Generate Report'}
                    </button>
                  </div>
                </div>
              )}

              {interview.turns.length > 0 && (
                <div className="aiq-subcard">
                  <div className="aiq-section-header compact">
                    <h3>Transcript</h3>
                    <span className="aiq-pill">{interview.turns.length} turns</span>
                  </div>
                  <div className="transcript">
                    {interview.turns.map((turn, idx) => (
                      <div key={idx} className="aiq-transcript-row">
                        <div>
                          <strong>Q{idx + 1}:</strong> {turn.q}
                        </div>
                        <div>
                          <strong>A{idx + 1}:</strong> {turn.a}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="aiq-subcard aiq-report-card">
                <div className="aiq-section-header compact">
                  <h3>Interview report</h3>
                  {interview.report && <span className="aiq-pill aiq-pill-success">Ready</span>}
                </div>
                {interview.report ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <small className="muted">Generated report</small>
                      <div>
                        <button
                          className="btn btn-light"
                          onClick={() => setReportExpanded((v) => !v)}
                          style={{ marginRight: 8 }}
                        >
                          {reportExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    </div>
                    <pre className={`aiq-report-preview ${reportExpanded ? 'expanded' : ''}`}>{interview.report}</pre>
                    <p className="muted">Use the Share panel to send this report (with context) to your doctors.</p>
                  </>
                ) : (
                  <p className="muted">Generate a report once the interview wraps up to archive the summary here.</p>
                )}
              </div>
            </section>
          </div>

          <div className="aiq-support-stack">
            <section className="card aiq-doctor-card">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">Care team</p>
                  <h2>Select doctors to notify</h2>
                </div>
                <span className="aiq-pill">{availableDoctorCount} selected</span>
              </header>
              <div className="aiq-doctor-toolbar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <input
                  className="form-input"
                  style={{ flex: '1 1 240px', minWidth: '240px' }}
                  placeholder="Search by name or specialty"
                  value={doctorSearch}
                  onChange={(e) => setDoctorSearch(e.target.value)}
                />
                <small className="muted" style={{ alignSelf: 'center' }}>
                  {normalizedQuery
                    ? noDoctorMatches
                      ? 'No matches'
                      : `${displayedDoctors.length} match${displayedDoctors.length === 1 ? '' : 'es'}`
                    : `Showing ${Math.min(displayedDoctors.length, doctors.length)} of ${doctors.length}`}
                </small>
              </div>
              <p className="muted">Choose the clinicians who should automatically receive updates when you save or share a report.</p>
              {staleSelections.length > 0 && (
                <div className="alert alert-warning">
                  <p>Some of your previously selected doctors are no longer available and have been removed from your selection:</p>
                  <ul>
                    {staleSelections.map((staleId) => (
                      <li key={staleId}>{staleId}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasUnavailableSelections && (
                <small className="aiq-hint" style={{ color: '#b45309' }}>
                  Some previously selected doctors are no longer available. Please re-select them below.
                </small>
              )}
              {noDoctorMatches ? (
                <div className="aiq-empty-state">No doctors match that search.</div>
              ) : displayedDoctors.length > 0 ? (
                <div className="aiq-doctor-grid">
                  {displayedDoctors.map((doctor, idx) => {
                    const doctorId = doctor?.id;
                    const optionKey = doctorId || doctor?.user_id || doctor?.email || `doctor-${idx}`;
                    const isSelectable = Boolean(doctorId);
                    const isChecked = isSelectable ? selectedDoctors.includes(doctorId) : false;
                    const isStale = isChecked && !doctorIdSet.has(doctorId);
                    return (
                      <label key={optionKey} className={`aiq-doctor-card-option ${isChecked ? 'selected' : ''} ${isStale ? 'stale' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!isSelectable}
                          onChange={(e) => {
                            if (!isSelectable) return;
                            if (e.target.checked) {
                              setSelectedDoctors((prev) => Array.from(new Set([...prev, doctorId])));
                            } else {
                              setSelectedDoctors((prev) => prev.filter((id) => id !== doctorId));
                            }
                          }}
                        />
                        <div>
                          <div className="aiq-doctor-name">{doctor.full_name || doctor.name || 'Doctor'} {isStale && <span className="badge danger" title="This doctor is no longer available and cannot be notified. Please unselect them.">Stale</span>}</div>
                          <div className="muted">{doctor.specialty || doctor.specialist || doctor.bio || 'General practice'}</div>
                          {!isSelectable && <small className="muted">Profile not eligible for sharing</small>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="aiq-empty-state">No doctors available right now.</div>
              )}
            </section>

            <section className="card aiq-share-card">
              <header className="aiq-section-header">
                <div>
                  <p className="aiq-eyebrow">Share interview</p>
                  <h2>Send summary to doctors</h2>
                </div>
              </header>
              <div className="aiq-share-status">
                <div>
                  <strong>Language</strong>
                  <span>{languageLabel}</span>
                </div>
                <div>
                  <strong>Doctors selected</strong>
                  <span>{availableDoctorCount}</span>
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => saveReportAndNotify(interview.report, { from: 'interview', turns: interview.turns, context: contextData })}
                disabled={shareDisabled}
              >
                Share with doctor{availableDoctorCount === 1 ? '' : 's'}
              </button>
              <small className="aiq-hint">Generate a report and select at least one doctor to enable sharing.</small>
              {hasUnavailableSelections && (
                <small className="aiq-hint" style={{ color: '#b45309' }}>
                  One or more saved selections are unavailable. Re-select them to notify those doctors.
                </small>
              )}
            </section>
          
            <section className="card aiq-context-card">
              <h3 className="card-title">Patient Context</h3>
              <p className="muted">Demographics, vitals, and uploads feed the AI prompts.</p>
              <small className="muted" style={{ display: 'block', marginBottom: '12px' }}>
                This panel refreshes automatically from your profile, vitals, and documents—no manual entry needed.
              </small>

              <div className="aiq-context-group">
                <strong>Demographics</strong>
                <div className="aiq-context-list">
                  <div>
                    <span>Name</span>
                    <span>{contextData.patient?.name || '—'}</span>
                  </div>
                  <div>
                    <span>Age</span>
                    <span>{contextData.patient?.age ?? '—'}</span>
                  </div>
                  <div>
                    <span>Gender</span>
                    <span>{contextData.patient?.gender || '—'}</span>
                  </div>
                  <div>
                    <span>Contact</span>
                    <span>{contextData.patient?.phone || contextData.patient?.email || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="aiq-context-group">
                <strong>Latest Vitals</strong>
                <div className="aiq-context-list">
                  {Array.isArray(contextData.vitals) && contextData.vitals.length > 0 ? (
                    contextData.vitals.map((vital, index) => (
                      <div key={`${vital.type || 'vital'}-${index}`}>
                        <span>{vital.type || vital.label || 'Metric'}</span>
                        <span>
                          {vital.value ?? '—'} {vital.unit || ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No recent vitals</div>
                  )}
                </div>
              </div>


              <div className="aiq-button-row">
                <button className="btn btn-light" onClick={refreshContext} disabled={contextLoading}>
                  {contextLoading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="btn btn-outline" onClick={() => alert('This context will be included in AI prompts.')}>How it’s used</button>
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
}

export default AIQuestionnairesPage;

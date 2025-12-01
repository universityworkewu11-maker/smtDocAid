import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import supabase, { getSupabaseStatus } from './lib/supabaseClient';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import './App.css';
import ThemeProvider, { useTheme } from './theme/ThemeProvider';
import Footer from './components/layout/Footer';
import FloatingDocAssistant from './components/FloatingDocAssistant';
import HealthBackground from './components/HealthBackground';
import SensorIconsBackground from './components/SensorIconsBackground';
import VitalsPage from './components/VitalsPage';
import UploadDocumentsPage from './components/UploadDocumentsPage';
import DoctorPatientView from './components/DoctorPatientView';
import DoctorProfilePage from './components/DoctorProfilePage';
import DoctorDirectoryPage from './components/DoctorDirectoryPage';
import DoctorPublicProfilePage from './components/DoctorPublicProfilePage';
import ScrollToTop from './components/ScrollToTop';
import DoctorNotificationsPage from './components/DoctorNotificationsPage';
// Interview flow is integrated into QuestionnairePage; no separate page import

// Config
// Supabase client is centralized in lib/supabaseClient.js

// AI backend config
const SERVER_BASE = (() => {
  const env = (process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5001';
  }
  return '';
})();

// Supabase table config (allow overriding via .env)
const TBL_REPORT = process.env.REACT_APP_TBL_REPORT || 'diagnoses';
const TBL_QR = process.env.REACT_APP_TBL_QR || 'questionnaire_responses';

const INTERVIEW_STORAGE_KEYS = Object.freeze({
  interview: 'interview_state_v1',
  base: 'api_server_base_v1',
  questionnaire: 'questionnaire_progress_v1',
  selectedDoctors: 'selected_doctors_v1'
});

async function openaiChat(messages) {
  // Always call backend server to keep API key private
  const res = await fetch(`${SERVER_BASE}/api/v1/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  const text = await res.text();
  if (!res.ok) {
    // Backend already masks invalid key messages
    throw new Error(text ? (JSON.parseSafe?.(text)?.error || text) : 'Server AI error');
  }
  try {
    const j = JSON.parse(text);
    return j?.text || '';
  } catch {
    return text;
  }
}

// Medical AI helper class
class MedicalAI {
  static async analyzePatientData(patientData, context = {}) {
    const systemPrompt = `You are a medical diagnosis assistant analyzing:
- Patient: ${patientData.age || 'unknown'}yo ${patientData.gender || ''}
- Symptoms: ${JSON.stringify(patientData.symptoms || {})}
- Vitals: ${JSON.stringify(patientData.vitals || {})}
- History: ${patientData.history || 'none'}
- Medications: ${patientData.medications || 'none'}
- Context: ${JSON.stringify(context || {})}

Provide structured analysis with:
1. Differential Diagnosis (ranked)
2. Recommended Tests
3. Treatment Options
4. Risk Assessment
5. Follow-up Plan

Use medical terminology but explain complex terms. Format as markdown.`;

    try {
      const response = await this._callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please analyze this case comprehensively.' }
      ]);

      try {
        await supabase.from(TBL_REPORT).insert([{
          patient_id: patientData.patientId || null,
          doctor_id: patientData.doctorId || null,
          content: response,
          ai_generated: true,
          severity: this._determineSeverity(response),
          metadata: {
            vitals: patientData.vitals || {},
            symptoms: patientData.symptoms || {},
            context
          }
        }]);
      } catch (e) {
        console.warn('Failed to save diagnosis:', e.message);
      }

      return response;
    } catch (error) {
      console.error('AI Analysis Error:', error);
      return this._getFallbackAnalysis(patientData);
    }
  }

  static _getFallbackAnalysis(patientData) {
    return `Demo Analysis (AI Unavailable)
    
**Differential Diagnosis**:
1. Viral Upper Respiratory Infection (40%)
2. Dehydration (30%)
3. Anxiety Disorder (20%)
4. Other (10%)

**Recommended Tests**:
- Complete Blood Count (CBC)
- Comprehensive Metabolic Panel (CMP)
- COVID-19 test if febrile

**Treatment Options**:
- Rest and hydration
- Antipyretics if fever > 101°F
- Follow-up in 3 days if symptoms persist

**Risk Assessment**: Low
**Follow-up Plan**: Telehealth visit in 3 days

Latest vitals: ${JSON.stringify(patientData.vitals || {})}`;
  }

  static async diagnose(patientData) {
    return this.analyzePatientData(patientData);
  }

  static async generateQuestionnaire(patientContext) {
    try {
      const contextSummary = JSON.stringify(patientContext || {});
      const systemPrompt = `You are a medical questionnaire generator. Using the provided patient context, generate a thorough clinical questionnaire designed to capture symptoms, vitals, relevant history, and document-relevant questions.\n\nSTRICT OUTPUT FORMAT (CRITICAL):\n- Return ONLY valid JSON.\n- Output must be ONLY a valid JSON array (no prose, no markdown, no backticks, no code fences).\n- Use double quotes for all keys and string values.\n- Include at least 15 items.\n- Each item MUST include exactly these fields: id (number), text (string), type (one of: "radio", "checkbox", "range", "text", "scale"), required (boolean).\n- Include an "options" (array of strings) ONLY when type is "radio" or "checkbox".\n- For type "range" or "scale", include numeric min and max fields.\n- Keep wording concise and clinically relevant.\n- Use the patient context to tailor a subset of questions.\n\nEXAMPLE (FORMAT ONLY, NOT CONTENT):\n[\n  {"id": 1, "text": "Chief complaint?", "type": "text", "required": true},\n  {"id": 2, "text": "Do you have a fever?", "type": "radio", "required": true, "options": ["Yes", "No"]}\n]\n\nReturn ONLY the JSON array. Do not include any text before or after.\n\nPatient context: ${contextSummary}`;

      const response = await this._callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Return ONLY valid JSON. Output only the JSON array of questions as described. No commentary. No markdown or code fences.' }
      ]);
      try {
        return this._parseQuestionnaire(response);
      } catch (parseErr) {
        // One-shot repair: ask the AI to convert to strict JSON array
  const repairInstr = `You will receive a draft questionnaire response that may contain prose or invalid JSON. Convert it into a VALID JSON array that follows this schema EXACTLY and return ONLY valid JSON (no prose, no markdown, no code fences):\n- Each item: { id:number, text:string, type:"radio"|"checkbox"|"range"|"text"|"scale", required:boolean, options?:string[], min?:number, max?:number }\n- Use double quotes for all keys and string values.\n- Include at least 15 items.\n- Include options only for radio/checkbox.\n- Include min and max only for range/scale.`;
        const repaired = await this._callAI([
          { role: 'system', content: repairInstr },
          { role: 'user', content: String(response || '') }
        ]);
        return this._parseQuestionnaire(repaired);
      }
    } catch (e) {
      console.error('Failed to generate questionnaire:', e);
      const msg = e?.message || '';
      throw new Error(`AI questionnaire generation failed. ${msg}`.trim());
    }
  }

  static _parseQuestionnaire(response) {
    try {
      const sanitize = (s) => {
        if (!s) return '';
        let t = String(s);
        // Strip code fences and headings
        t = t.replace(/```(?:json)?[\s\S]*?```/gi, (m) => m.replace(/```(?:json)?/i, '').replace(/```$/, ''));
        t = t.replace(/^#+\s.*$/gm, ''); // remove markdown headers
        // If contains a JSON array somewhere, slice to it
        const first = t.indexOf('[');
        const last = t.lastIndexOf(']');
        if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
        // Remove trailing commas before } or ]
        t = t.replace(/,\s*([}\]])/g, '$1');
        // Normalize smart quotes
        t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        return t.trim();
      };

      let text = sanitize(response);
      let arr = [];
      try {
        arr = JSON.parse(text);
      } catch {
        // last resort: try to extract the largest JSON array again
        const m = text.match(/\[[\s\S]*\]/);
        if (m) {
          const cleaned = sanitize(m[0]);
          arr = JSON.parse(cleaned);
        } else {
          throw new Error('No JSON array found');
        }
      }

      if (!Array.isArray(arr)) throw new Error('Invalid questionnaire format');

      return arr.map((q, i) => {
        const type = ['radio','checkbox','range','text','scale'].includes(q.type) ? q.type : 'text';
        const base = {
          id: Number.isFinite(q.id) ? q.id : (parseInt(q.id, 10) || i + 1),
          text: String(q.text || `Question ${i + 1}`),
          type,
          required: typeof q.required === 'boolean' ? q.required : Boolean(q.required)
        };

        if (type === 'radio' || type === 'checkbox') {
          base.options = Array.isArray(q.options) ? q.options.map(String) : ['Yes', 'No'];
        }
        if (type === 'range' || type === 'scale') {
          base.min = Number.isFinite(q.min) ? q.min : 1;
          base.max = Number.isFinite(q.max) ? q.max : 10;
        }
        return base;
      });
    } catch (e) {
      console.warn('Questionnaire parse failed:', e);
      throw new Error('Failed to parse AI-generated questionnaire. Please try again.');
    }
  }


  static async _callAI(messages) {
    // Always route via backend
    return openaiChat(messages);
  }

  static _determineSeverity(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('emergency') || lower.includes('immediate')) return 'high';
    if (lower.includes('urgent') || lower.includes('soon')) return 'medium';
    return 'low';
  }
}

// Auth context
const AuthContext = createContext(null);

function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(session);

      if (session?.user) {
        try {
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
        setLoading(true);
        setSession(sess);
        if (sess?.user) {
          const p = await fetchProfile(sess.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
        setLoading(false);
      });

      return () => {
        mounted = false;
        subscription?.unsubscribe();
      };
    }

    init();
  }, []);

  async function fetchProfile(userId) {
    // Try to fetch existing profile
    const { data: existing, error: selError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .single();

    if (!selError && existing) {
      // Ensure doctor has a public profile row after login
      if (existing.role === 'doctor') {
        try {
          const { data: userRes } = await supabase.auth.getUser();
          const email = userRes?.user?.email || null;
          await supabase.from('doctor_profiles').upsert({
            user_id: userId,
            full_name: existing.full_name || (email ? email.split('@')[0] : null),
            email: email || null
          });
        } catch (e) {
          console.warn('ensure doctor_profiles (existing) failed:', e?.message || e);
        }
      } else if (existing.role === 'patient') {
        // Ensure a patient profile row exists for patients
        try {
          await supabase.from('patient_profiles').upsert({
            user_id: userId,
            full_name: existing.full_name || null,
            phone: '',
            address: '',
            medical_history: '',
            current_medications: ''
          });
        } catch (e) {
          console.warn('ensure patient_profiles (existing) failed:', e?.message || e);
        }
        // Ensure public.patients row with email for authenticated patient
        try {
          const { data: userRes } = await supabase.auth.getUser();
          const email = userRes?.user?.email || null;
          const meta = userRes?.user?.user_metadata || {};
          const full_name = existing.full_name || meta.full_name || (email ? email.split('@')[0] : null);
          await supabase.from('patients').upsert({
            user_id: userId,
            full_name,
            name: full_name,
            email
          });
        } catch (e) {
          console.warn('ensure patients (existing) failed:', e?.message || e);
        }
      }
      return existing;
    }

    // Create default profile if not found (prefer user metadata from signup)
    const { data: userRes } = await supabase.auth.getUser();
    const email = userRes?.user?.email || 'user@example.com';
    const meta = userRes?.user?.user_metadata || {};
    const full_name = String(meta.full_name || email.split('@')[0]);
    const role = String(meta.role || (email.endsWith('@hospital.com') ? 'doctor' : 'patient'));

    const { data: upserted, error: upError } = await supabase
      .from('profiles')
      .upsert({ id: userId, full_name, role })
      .select()
      .single();

    if (upError) {
      console.error('Profile creation failed:', upError);
      return { id: userId, full_name, role };
    }

    // Ensure doctor has a public profile row after creating profile
    try {
      if ((upserted?.role || role) === 'doctor') {
        await supabase.from('doctor_profiles').upsert({
          user_id: userId,
          full_name: upserted?.full_name || full_name,
          email
        });
      } else if ((upserted?.role || role) === 'patient') {
        await supabase.from('patient_profiles').upsert({
          user_id: userId,
          full_name: upserted?.full_name || full_name,
          phone: '',
          address: '',
          medical_history: '',
          current_medications: ''
        });
        // Also upsert into public.patients with email for quick access and filtering
        try {
          await supabase.from('patients').upsert({
            user_id: userId,
            full_name: upserted?.full_name || full_name,
            name: upserted?.full_name || full_name,
            email
          });
        } catch (e) {
          console.warn('ensure patients (created) failed:', e?.message || e);
        }
      }
    } catch (e) {
      console.warn('ensure doctor_profiles (created) failed:', e?.message || e);
    }

    return upserted;
  }

  async function updateProfileRole(newRole) {
    if (!session?.user) return;
    
    const email = session.user.email || 'user@example.com';
    const full_name = profile?.full_name || email.split('@')[0];
    
    await supabase
      .from('profiles')
      .upsert({ id: session.user.id, full_name, role: newRole });
      
    try {
      window.localStorage.setItem('roleOverride', newRole);
    } catch (_) {}
    
    setProfile(prev => ({ 
      ...(prev || { id: session.user.id, full_name }), 
      role: newRole 
    }));
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, updateProfileRole }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children, role }) {
  const auth = useAuth();

  console.log('ProtectedRoute: auth.loading =', auth.loading, 'auth.session =', !!auth.session, 'auth.profile?.role =', auth.profile?.role, 'required role =', role);

  if (auth.loading) {
    console.log('ProtectedRoute: Showing loading...');
    return <div className="p-6">Loading...</div>;
  }
  if (!auth.session) {
    console.log('ProtectedRoute: No session, redirecting to /login');
    return <Navigate to="/login" replace />;
  }
  
  const effectiveRole = auth.profile?.role;
  
  if (role && effectiveRole !== role) {
    console.log('ProtectedRoute: Wrong role, showing RoleGate');
    return <RoleGate requiredRole={role} />;
  }
  
  console.log('ProtectedRoute: Access granted, rendering children');
  return children;
}function RoleGate({ requiredRole }) {
  const auth = useAuth();
  const navigate = useNavigate();

  console.log('RoleGate: Showing access restricted for role:', requiredRole, 'user role:', auth.profile?.role);

  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h2 className="card-title">Access restricted</h2>
      <p style={{ marginBottom: 16 }}>
        This area requires the "{requiredRole}" role. Your current role is "{auth.profile?.role || 'unknown'}".
      </p>
      
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => {
            const r = auth.profile?.role;
            if (r === 'patient') navigate('/patient', { replace: true });
            else if (r === 'doctor') navigate('/doctor', { replace: true });
            else if (r === 'admin') navigate('/admin', { replace: true });
            else navigate('/', { replace: true });
          }}
        >
          Go to my portal
        </button>
      </div>
    </div>
  );
}

// Route transition wrapper (fade out old route before swapping in new one)
function RouteTransitionWrapper({ children }) {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [stage, setStage] = useState('enter');

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname) setStage('exit');
  }, [location, displayLocation]);

  const handleAnimationEnd = () => {
    if (stage === 'exit') {
      setDisplayLocation(location);
      setStage('enter');
    }
  };

  const cls = stage === 'exit' ? 'route-exit' : 'route-screen';
  return (
    <div className={`route-wrapper ${cls}`} onAnimationEnd={handleAnimationEnd}>
      {typeof children === 'function' ? children(displayLocation) : children}
    </div>
  );
}

function Header() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [animEnabled, setAnimEnabled] = useState(true);
  const sb = getSupabaseStatus();

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  useEffect(() => {
    const body = document.body;
    if (!animEnabled) body.classList.add('no-animations');
    else body.classList.remove('no-animations');
  }, [animEnabled]);

  return (
    <header>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="header-content">
        <Link to="/" className="logo" title="Go to Home">
          <span className="logo-icon" aria-hidden>🏥</span>
          <span className="sr-only">SmartDocAid Home</span>
          SmartDocAid
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {!auth.session && (
            <Link to="/" className="nav-link">Home</Link>
          )}
          {auth.session && auth.profile && (
            <>
              {auth.profile.role === 'patient' && <Link to="/patient" className="nav-link">Patient</Link>}
              {auth.profile.role === 'doctor' && <Link to="/doctor" className="nav-link">Doctor</Link>}
              {auth.profile.role === 'doctor' && <Link to="/doctor/profile" className="nav-link">My Profile</Link>}
              {auth.profile.role === 'doctor' && <Link to="/doctor/notifications" className="nav-link">Notifications</Link>}
              {auth.profile.role === 'admin' && <Link to="/admin" className="nav-link">Admin</Link>}
            </>
          )}
        </nav>
        <div className="auth-buttons">
          <span className="badge" title={sb.url ? sb.url : 'Supabase URL not set'} style={{ marginRight: 8 }}>
            Supabase: {sb.hasUrl && sb.hasKey ? 'OK' : 'Not configured'}
          </span>
          <button
            className="btn btn-secondary"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggle}
          >
            {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
          <button
            className="btn btn-outline"
            aria-label={animEnabled ? 'Disable animations' : 'Enable animations'}
            title={animEnabled ? 'Disable animations' : 'Enable animations'}
            onClick={() => setAnimEnabled(a => !a)}
          >
            {animEnabled ? '🌀 Anim On' : '💤 Anim Off'}
          </button>
          {auth.session ? (
            <div className="flex items-center space-x-4">
              <span className="user-display">{auth.profile?.full_name || auth.session.user.email}</span>
              <span className="badge" style={{ marginLeft: 8 }}>{auth.profile?.role || 'unknown'}</span>
              {auth.profile?.role === 'patient' && (
                <Link to="/patient/profile" className="btn btn-secondary" style={{ marginLeft: 8 }}>Edit Profile</Link>
              )}
              <button onClick={signOut} className="btn btn-danger" style={{ marginLeft: 8 }}>
                Sign Out
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-primary">Login</Link>
              <Link to="/signup" className="btn btn-secondary">Sign Up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HomePage() {
  const auth = useAuth();
  
  return (
    <main className="route-screen">
      <section className="hero animate-fade-up">
        <h1 className="hero-title">
          Experience <span className="hero-gradient">next‑gen healthcare</span>
        </h1>
        <p className="hero-subtitle">
          One platform for patients, doctors, and admins — AI‑assisted, privacy‑first, and designed with care.
        </p>
        <div className="hero-cta">
          <Link to="/signup" className="btn btn-primary">Create account</Link>
          <Link to="/login" className="btn btn-light">Sign in</Link>
        </div>
        {auth.session && (
          <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">
            Signed in as <strong>{auth.profile?.full_name}</strong> · Role: <span className="badge">{auth.profile?.role}</span>
          </div>
        )}
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-2xl font-extrabold">99.9%</div><div className="muted">Uptime</div></div>
          <div className="hero-stat"><div className="text-2xl font-extrabold">HIPAA‑minded</div><div className="muted">Privacy</div></div>
          <div className="hero-stat"><div className="text-2xl font-extrabold">AI‑assisted</div><div className="muted">Workflows</div></div>
        </div>
        <div className="hero-parallax-layer" aria-hidden="true">
          <div className="blob indigo"></div>
          <div className="blob cyan"></div>
        </div>
      </section>

      <section className="feature-grid stagger">
        <div className="feature-card tilt">
          <h3>Patient Portal</h3>
          <p>View vitals, complete questionnaires, and receive AI summaries tailored to your health.</p>
          <div className="mt-4"><Link to="/patient" className="btn btn-primary">Enter Portal</Link></div>
        </div>
        <div className="feature-card tilt">
          <h3>Doctor Portal</h3>
          <p>See patient overviews, review AI‑generated reports, and add clinical feedback efficiently.</p>
          <div className="mt-4"><Link to="/doctor" className="btn btn-success">Enter Portal</Link></div>
        </div>
        <div className="feature-card tilt">
          <h3>Admin</h3>
          <p>Manage users and configuration with insight into system health and usage patterns.</p>
          <div className="mt-4"><Link to="/admin" className="btn btn-secondary">Enter Portal</Link></div>
        </div>
      </section>
    </main>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const auth = useAuth();
  const navigate = useNavigate();
  const [auxLoading, setAuxLoading] = useState({ magic: false, reset: false, resend: false });

  useEffect(() => {
    if (!auth.session) return;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        let nextRole = 'patient';
        if (uid) {
          try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', uid)
              .single();
            if (prof?.role) nextRole = String(prof.role);
            else if (userRes?.user?.user_metadata?.role) nextRole = String(userRes.user.user_metadata.role);
          } catch (_) {
            if (userRes?.user?.user_metadata?.role) nextRole = String(userRes.user.user_metadata.role);
          }
        }
        navigate(`/${nextRole}`, { replace: true });
      } catch (_) {
        navigate('/', { replace: true });
      }
    })();
  }, [auth.session, navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setError(error.message);
      // Common hint: unconfirmed email
      if (/confirm/i.test(error.message)) {
        try { alert('Your email may be unconfirmed. Please check your inbox for the confirmation email or click "Resend confirmation" below.'); } catch (_) {}
      }
    } else {
      try {
        // After successful login, route to the correct portal based on role
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        let role = 'patient';
        if (uid) {
          try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role, full_name')
              .eq('id', uid)
              .single();
            if (prof?.role) role = String(prof.role);
            else if (userRes?.user?.user_metadata?.role) role = String(userRes.user.user_metadata.role);
          } catch (_) {
            if (userRes?.user?.user_metadata?.role) role = String(userRes.user.user_metadata.role);
          }
        }
        navigate(`/${role}`);
      } catch (_) {
        // Fallback to home if role-based redirect fails
        navigate('/');
      }
    }
    
    setLoading(false);
  }

  async function loginWithMagicLink() {
    setAuxLoading(prev => ({ ...prev, magic: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;
      alert('Magic link sent. Check your email to complete sign-in.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, magic: false }));
    }
  }

  async function resendConfirmation() {
    setAuxLoading(prev => ({ ...prev, resend: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      alert('Confirmation email resent. Please check your inbox.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, resend: false }));
    }
  }

  async function requestPasswordReset() {
    setAuxLoading(prev => ({ ...prev, reset: true }));
    setError('');
    try {
      if (!email) {
        setError('Enter your email first');
        return;
      }
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      alert('Password reset email sent. Open the link on this device to set a new password.');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAuxLoading(prev => ({ ...prev, reset: false }));
    }
  }

  return (
  <main className="route-screen">
      <div className="card form-container">
        <h2 className="card-title">Login</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <div style={{marginTop: 16, display: 'grid', gap: 8}}>
          <button
            className="btn btn-secondary"
            onClick={loginWithMagicLink}
            disabled={auxLoading.magic}
            title="Send a magic sign-in link to your email"
          >
            {auxLoading.magic ? 'Sending…' : 'Login via Magic Link'}
          </button>
          <button
            className="btn btn-outline"
            onClick={resendConfirmation}
            disabled={auxLoading.resend}
            title="Resend email confirmation"
          >
            {auxLoading.resend ? 'Resending…' : 'Resend Confirmation Email'}
          </button>
          <button
            className="btn btn-outline"
            onClick={requestPasswordReset}
            disabled={auxLoading.reset}
            title="Send a password reset link to your email"
          >
            {auxLoading.reset ? 'Sending…' : 'Forgot Password? Reset'}
          </button>
        </div>
        <p style={{textAlign: 'center', marginTop: '20px'}}>
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  );
}

function ResetPasswordPage() {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Attempt to set session from URL hash if present (access_token, refresh_token)
    (async () => {
      try {
        const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '';
        const qs = new URLSearchParams(hash.replace(/^#/, ''));
        const at = qs.get('access_token');
        const rt = qs.get('refresh_token');
        if (at && rt) {
          await supabase.auth.setSession({ access_token: at, refresh_token: rt });
        }
      } catch (_) {}
    })();
  }, []);

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError('');
    if (pw1.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (pw1 !== pw2) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      alert('Password updated. You can now log in.');
      navigate('/login');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="card form-container">
        <h2 className="card-title">Reset Password</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleUpdatePassword}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              className="form-input"
              type="password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </main>
  );
}

function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSignup(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role, full_name: fullName } }
      });
      
      if (authError) {
        throw authError;
      }
      
      const userId = data.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({ 
          id: userId, 
          full_name: fullName, 
          role 
        });
        // If signing up as a doctor, also create a public doctor profile row so patients can find them immediately
        if (role === 'doctor') {
          try {
            await supabase.from('doctor_profiles').upsert({
              user_id: userId,
              full_name: fullName,
              email
            });
          } catch (e) {
            console.warn('doctor_profiles upsert failed (signup):', e?.message || e);
          }
        }
      }
      
      // If email confirmation is disabled and a session is created, route directly now by chosen role
      if (data?.session) {
        navigate(`/${role}`);
      } else {
        alert('Signup successful! Please check your email for confirmation.');
        navigate('/login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="card form-container">
        <h2 className="card-title">Sign Up</h2>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSignup}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              placeholder="Full Name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="btn btn-primary"
            style={{width: '100%', padding: '12px'}}
          >
            {loading ? 'Signing up...' : 'Sign Up'}
          </button>
        </form>
      </div>
    </main>
  );
}

function PatientPortal() {
  const auth = useAuth();
  const navigate = useNavigate();
  const user = auth.session?.user || null;
  const patientId = user?.id || null;
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured

  // Check Raspberry Pi device connectivity via /health endpoint
  const checkDevice = async () => {
    const base = process.env.REACT_APP_RPI_API_BASE;
    if (!base) {
      setDeviceStatus('not-configured');
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setDeviceStatus(res.ok ? 'connected' : 'offline');
    } catch (_) {
      setDeviceStatus('offline');
    }
  };

  useEffect(() => {
    checkDevice();
  }, []);

  // Removed inline health report generation from dashboard in favor of guided flow

  return (
    <main>
  <section className="hero animate-fade-up">
        <h1 className="hero-title">Patient Overview</h1>
        <p className="hero-subtitle">Track real‑time vitals, complete assessments, and generate AI health insights.</p>
        <div className="hero-cta">
          <button onClick={() => navigate('/patient/vitals')} className="btn btn-primary" disabled={!user}>Start Assessment</button>
          <Link to="/patient/questionnaire" className="btn btn-light">Questionnaire</Link>
        </div>
        {auth.profile?.full_name && (
          <div className="mt-6 text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-2 items-center">
            <span>Signed in as <strong>{auth.profile.full_name}</strong></span>
            {patientId && <span className="badge">PID-{patientId.slice(0,8)}</span>}
            <span className={`badge ${deviceStatus === 'connected' ? 'success' : deviceStatus === 'offline' ? 'danger' : ''}`}>
              {deviceStatus === 'checking' ? 'Checking device…' : deviceStatus === 'connected' ? 'Device connected' : deviceStatus === 'offline' ? 'Device offline' : 'Not configured'}
            </span>
          </div>
        )}
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-xl font-semibold">Temp</div><div className="text-3xl font-extrabold">98.6°</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Heart</div><div className="text-3xl font-extrabold">72 bpm</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">SpO₂</div><div className="text-3xl font-extrabold">98%</div></div>
        </div>
        <div className="hero-parallax-layer" aria-hidden="true">
          <div className="blob indigo"></div>
          <div className="blob cyan"></div>
        </div>
      </section>

      <section className="feature-grid stagger">
        <div className="feature-card tilt">
          <h3>Health Assessment</h3>
          <p>Guided flow collecting vitals, documents, and questionnaire answers for AI synthesis.</p>
          <div className="mt-4"><button onClick={() => navigate('/patient/vitals')} className="btn btn-primary" disabled={!user}>Begin</button></div>
        </div>
  <div className="feature-card tilt">
          <h3>Questionnaire</h3>
          <p>Adaptive interview and structured questions tailor insights to your current condition.</p>
          <div className="mt-4"><Link to="/patient/questionnaire" className="btn btn-light">Open</Link></div>
        </div>
  <div className="feature-card tilt">
          <h3>Documents</h3>
          <p>Securely upload lab reports and imaging; AI references them in assessment generation.</p>
          <div className="mt-4"><Link to="/patient/uploads" className="btn btn-secondary">Manage</Link></div>
        </div>
  <div className="feature-card tilt">
          <h3>Doctors</h3>
          <p>Browse verified doctors and view public profiles to coordinate care.</p>
          <div className="mt-4"><Link to="/patient/doctors" className="btn btn-success">Directory</Link></div>
        </div>
  <div className="feature-card tilt">
          <h3>Profile</h3>
          <p>Keep demographics and background updated for more accurate recommendations.</p>
          <div className="mt-4"><Link to="/patient/profile" className="btn btn-light">Edit</Link></div>
        </div>
        <div className="feature-card tilt">
          <h3>AI Questionnaires</h3>
          <p>Interactive AI-powered interviews with doctor selection and report sharing.</p>
          <div className="mt-4"><Link to="/patient/questionnaire" className="btn btn-primary">Start AI Interview</Link></div>
        </div>
        <div className="feature-card tilt">
          <h3>AI Reports</h3>
          <p>View reports generated from your latest completed assessments and questionnaires.</p>
          <div className="mt-4"><Link to="/patient/questionnaire" className="btn btn-primary">View</Link></div>
        </div>
      </section>
    </main>
  );
}

function QuestionnairePage() {
  const [questions, setQuestions] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState({ generate: false, report: false });
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  
  const auth = useAuth();
  // Interview-mode state (AI-driven sequential Q&A)
  const [interview, setInterview] = useState({ sessionId: null, question: '', turns: [], done: false });
  const [iAnswer, setIAnswer] = useState('');
  const [iLoading, setILoading] = useState({ start: false, next: false, report: false });
  const [serverBase, setServerBase] = useState(SERVER_BASE);

  // Doctor selection for sharing reports
  const [selectedDoctors, setSelectedDoctors] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorQuery, setDoctorQuery] = useState('');
  const [filteredDoctors, setFilteredDoctors] = useState([]);

  // Generic POST helper with fallback to localhost:5001 if current base fails/non-JSON
  const apiPostJSON = async (path, body) => {
    const attempt = async (base) => {
      const url = `${base || ''}${path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const raw = await resp.text();
      let j; try { j = JSON.parse(raw); } catch {
        throw new Error(`Backend did not return JSON (status ${resp.status}). Is the server running?`);
      }
      if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      return j;
    };
    try {
      return await attempt(serverBase);
    } catch (e1) {
      if (serverBase !== 'http://localhost:5001') {
        try {
          const j2 = await attempt('http://localhost:5001');
          setServerBase('http://localhost:5001');
          return j2;
        } catch (_) {}
      }
      throw e1;
    }
  };

  // Restore persisted base/interview on mount so minimizing or route changes don't reset
  useEffect(() => {
    try {
      const savedBase = window.localStorage.getItem(INTERVIEW_STORAGE_KEYS.base);
      if (savedBase) setServerBase(savedBase);
    } catch (_) {}
    try {
      const raw = window.localStorage.getItem(INTERVIEW_STORAGE_KEYS.interview);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.sessionId || parsed.turns)) {
          setInterview({
            sessionId: parsed.sessionId || null,
            question: parsed.question || '',
            turns: Array.isArray(parsed.turns) ? parsed.turns : [],
            done: Boolean(parsed.done)
          });
          // If a report was already generated and saved elsewhere, show it
          if (parsed.report) {
            try { setReport(String(parsed.report)); } catch (_) {}
          }
        }
      }
    } catch (_) {}
    // Restore selected doctors
    try {
      const rawSel = window.localStorage.getItem(INTERVIEW_STORAGE_KEYS.selectedDoctors);
      if (rawSel) {
        const parsed = JSON.parse(rawSel);
        if (Array.isArray(parsed)) setSelectedDoctors(parsed);
      }
    } catch (_) {}
    // Fetch available doctors for selection
    try { fetchDoctors(); } catch (_) {}
  }, []);

  // Persist base and interview whenever they change
  useEffect(() => {
    try { window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.base, serverBase || ''); } catch (_) {}
  }, [serverBase]);
  useEffect(() => {
    try { window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify({ ...interview, report })); } catch (_) {}
  }, [interview, report]);

  // Persist selected doctors so choices survive reloads/navigation
  useEffect(() => {
    try { window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.selectedDoctors, JSON.stringify(selectedDoctors)); } catch (_) {}
  }, [selectedDoctors]);

  // testOpenAI removed - developer test helper was removed from UI

  // Interview mode helpers
  async function buildInterviewContext() {
    let vitals = [];
    let uploads = [];
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vitals_data') : null;
      vitals = stored ? JSON.parse(stored) : [];
    } catch (_) {}
    try {
      const uid = auth?.session?.user?.id;
      if (uid) {
        const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
        const { data } = await supabase.storage.from(bucket).list(uid, { limit: 50 });
        uploads = (data || []).map(i => i.name);
      }
    } catch (_) {}
    return { vitals, uploads };
  }

  async function startInterview() {
    setILoading(prev => ({ ...prev, start: true }));
    setError('');
    setReport('');
    try {
      const context = await buildInterviewContext();
      const j = await apiPostJSON('/api/v1/ai/interview/start', { context });
      if (!j.ok) throw new Error(j?.error || 'Interview start failed');
  setInterview({ sessionId: j.sessionId, question: j.question || '', turns: [], done: Boolean(j.done) });
  try { window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify({ sessionId: j.sessionId, question: j.question || '', turns: [], done: Boolean(j.done), report: '' })); } catch (_) {}
      setIAnswer('');
      // Hide legacy list UI on start
      setQuestions([]);
      setAnswers({});
      setCurrentStep(0);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, start: false }));
    }
  }

  async function sendInterviewAnswer() {
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
        done: Boolean(j.done)
      }));
      setIAnswer('');
      // Persist update
      try {
        const nextState = {
          sessionId: interview.sessionId,
          question: j.done ? '' : (j.question || ''),
          turns: [...interview.turns, { q: interview.question, a }],
          done: Boolean(j.done),
          report
        };
        window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify(nextState));
      } catch (_) {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, next: false }));
    }
  }

  // Fetch doctors (used for sharing reports)
  async function fetchDoctors() {
    try {
      let data = [];
      try {
        const res = await supabase
          .from('doctors')
          .select('id, user_id, name, email, specialist, bio, license_number, age, updated_at')
          .order('updated_at', { ascending: false })
          .limit(100);
        if (res.error) throw res.error;
        data = res.data || [];
      } catch (_) {
        const res2 = await supabase
          .from('doctor_profiles')
          .select('id, user_id, full_name, email, specialty, location, city, bio, updated_at')
          .order('updated_at', { ascending: false })
          .limit(100);
        if (res2.error) throw res2.error;
        data = res2.data || [];
      }
      setDoctors(data || []);
      try { setFilteredDoctors(data || []); } catch (_) {}
    } catch (err) {
      console.error('fetchDoctors error:', err);
    }
  }

  // Keep filtered list in sync with query
  useEffect(() => {
    try {
      const q = String(doctorQuery || '').trim().toLowerCase();
      if (!q) {
        setFilteredDoctors(doctors || []);
        return;
      }
      const out = (doctors || []).filter(d => {
        const name = String(d.full_name || d.name || d.user_id || '').toLowerCase();
        const spec = String(d.specialist || d.specialty || d.specialities || d.city || '').toLowerCase();
        const email = String(d.email || '').toLowerCase();
        return name.includes(q) || spec.includes(q) || email.includes(q);
      });
      setFilteredDoctors(out);
    } catch (_) {
      setFilteredDoctors(doctors || []);
    }
  }, [doctorQuery, doctors]);

  async function generateInterviewReport() {
    if (!interview.sessionId) return;
    setILoading(prev => ({ ...prev, report: true }));
    setError('');
    try {
      const j = await apiPostJSON('/api/v1/ai/interview/report', { sessionId: interview.sessionId });
      if (!j.ok) throw new Error(j?.error || 'Report failed');
      setReport(j.report || '');
      try {
        const raw = window.localStorage.getItem(INTERVIEW_STORAGE_KEYS.interview);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.report = j.report || '';
        window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify(parsed));
      } catch (_) {}
      // Persist AI report as with legacy mode
      try {
        const uid = auth?.session?.user?.id;
        if (uid) {
          await supabase.from(TBL_REPORT).insert([{
            patient_id: uid,
            doctor_id: null,
            content: j.report || '',
            ai_generated: true,
            severity: MedicalAI._determineSeverity(j.report || ''),
            metadata: { from: 'interview', turns: interview.turns, created_via: 'QuestionnairePage.generateInterviewReport' }
          }]);
        }
      } catch (_) {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setILoading(prev => ({ ...prev, report: false }));
    }
  }

  function restartInterview() {
    setInterview({ sessionId: null, question: '', turns: [], done: false });
    setIAnswer('');
    setReport('');
    setError('');
    try {
      const raw = window.localStorage.getItem(INTERVIEW_STORAGE_KEYS.interview);
      if (raw) {
        const parsed = JSON.parse(raw);
        window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify({ ...parsed, sessionId: null, question: '', turns: [], done: false, report: '' }));
      } else {
        window.localStorage.setItem(INTERVIEW_STORAGE_KEYS.interview, JSON.stringify({ sessionId: null, question: '', turns: [], done: false, report: '' }));
      }
    } catch (_) {}
  }

  // runHealthCheck removed - kept in codebase but not exposed in UI

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    try { window.localStorage.setItem('questionnaireAnswers', JSON.stringify({ ...answers, [questionId]: value })); } catch (_) {}
  };

  // Questions are generated by AI and are read-only

  // Removed key management UI; keys are now server-side only

  async function generateReport() {
    setLoading(prev => ({ ...prev, report: true }));
    setError('');
    
    try {
      const summary = questions.map(q => {
        const answer = answers[q.id];
        return `${q.text}: ${Array.isArray(answer) ? answer.join(', ') : answer || 'N/A'}`;
      }).join('\n');

      const report = await openaiChat([
        { 
          role: 'system', 
          content: 'Generate a health report based on questionnaire answers. First provide a doctor-facing analysis, then patient-facing advice.' 
        },
        { 
          role: 'user', 
          content: summary 
        }
      ]);
      
      setReport(report);

      // Persist AI report to Supabase (report table) and notify selected doctors
      try {
        const uid = auth?.session?.user?.id;
        if (uid) {
          const { data: inserted, error: insErr } = await supabase.from(TBL_REPORT)
            .insert([{
              patient_id: uid,
              doctor_id: null,
              content: report,
              ai_generated: true,
              severity: MedicalAI._determineSeverity(report),
              metadata: { 
                from: 'questionnaire',
                answers: answers,
                created_via: 'QuestionnairePage.generateReport'
              }
            }])
            .select('id')
            .single();

          if (insErr) {
            console.warn('Failed to save AI report:', insErr?.message || insErr);
          } else {
            // If doctors were selected, create notifications for them (best-effort)
            if (Array.isArray(selectedDoctors) && selectedDoctors.length > 0) {
              try {
                const notifications = selectedDoctors.map(docId => ({
                  doctor_id: docId,
                  patient_id: uid,
                  report_id: inserted?.id || null,
                  message: `New AI-generated report available for patient ${auth?.session?.user?.email || 'patient'}`,
                  type: 'report_shared',
                  is_read: false
                }));

                const { error: notifErr } = await supabase.from('notifications').insert(notifications);
                if (notifErr) console.warn('Failed to create notifications:', notifErr);
              } catch (notifEx) {
                console.warn('Notification creation failed:', notifEx);
              }
            }
          }
        }
      } catch (persistErr) {
        console.warn('Failed to save AI report and notify:', persistErr?.message || persistErr);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(prev => ({ ...prev, report: false }));
    }
  }

  const handleSubmit = () => {
    (async () => {
      try {
        // Enforce at least one input across the flow (vitals, uploads, or questionnaire answers)
        const any = (() => {
          try {
            const vd = JSON.parse(window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data') || 'null');
            const anyVital = vd && ((vd.temperature && vd.temperature.value != null) || (vd.heartRate && vd.heartRate.value != null) || (vd.spo2 && vd.spo2.value != null));
            const uploads = JSON.parse(window.localStorage.getItem('uploadedDocuments') || '[]');
            const anyUpload = Array.isArray(uploads) && uploads.length > 0;
            const ans = JSON.parse(window.localStorage.getItem('questionnaireAnswers') || '{}');
            const anyAnswer = ans && Object.values(ans).some(v => Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== ''));
            return Boolean(anyVital || anyUpload || anyAnswer);
          } catch (_) { return false; }
        })();
        if (!any) {
          alert('Please provide at least one input (a vital, an upload, or an answer) before submitting.');
          return;
        }
        const uid = auth?.session?.user?.id;
        if (uid) {
          await supabase.from(TBL_QR).insert([{
            patient_id: uid,
            responses: answers,
            submitted_at: new Date().toISOString()
          }]);
        }
      } catch (e) {
        console.warn('Failed to save questionnaire responses:', e?.message || e);
      } finally {
        alert('Questionnaire submitted successfully');
        setQuestions([]);
        setAnswers({});
        setCurrentStep(0);
        try { window.localStorage.removeItem('questionnaireAnswers'); } catch (_) {}
      }
    })();
  };

  const renderQuestion = (question) => {
    switch (question.type) {
      case 'radio':
        return (
          <div className="radio-group">
            {question.options.map(option => (
              <label key={option} className="radio-option">
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option}
                  checked={answers[question.id] === option}
                  onChange={() => handleAnswer(question.id, option)}
                />
                {option}
              </label>
            ))}
          </div>
        );
      case 'checkbox':
        return (
          <div className="checkbox-group">
            {question.options.map(option => {
              const selected = Array.isArray(answers[question.id]) ? answers[question.id] : [];
              return (
                <label key={option} className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => {
                      const updated = selected.includes(option)
                        ? selected.filter(x => x !== option)
                        : [...selected, option];
                      handleAnswer(question.id, updated);
                    }}
                  />
                  {option}
                </label>
              );
            })}
          </div>
        );
      case 'range':
        return (
          <div className="range-container">
            <input
              type="range"
              min={question.min}
              max={question.max}
              value={answers[question.id] || Math.round((question.min + question.max) / 2)}
              onChange={e => handleAnswer(question.id, parseInt(e.target.value))}
              className="range-slider"
            />
            <div className="range-value">
              {answers[question.id] || Math.round((question.min + question.max) / 2)}
            </div>
          </div>
        );
      default:
        return (
          <textarea
            value={answers[question.id] || ''}
            onChange={e => handleAnswer(question.id, e.target.value)}
            className="textarea-input"
            placeholder="Your answer..."
          />
        );
    }
  };

  return (
    <main>
        <div className="card questionnaire-container route-screen">
          <div style={{ maxWidth: 980, margin: '0 auto', padding: 20 }}>
        <div className="questionnaire-header">
          <h1 className="card-title">Health Questionnaire</h1>
        </div>

        {/* Centered primary action */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={startInterview}
            disabled={iLoading.start}
            title="Start Interview"
            style={{ padding: '12px 28px', width: '100%', maxWidth: 420 }}
          >
            {iLoading.start ? 'Starting…' : 'Start Interview'}
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

  {/* Doctor selection for report sharing */}
  <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Select Doctors to Share Report With</h3>
          <p className="muted">Choose which doctors should receive your AI-generated health report after the assessment.</p>
          {filteredDoctors.length > 0 ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 8 }}>
                <input
                  className="form-input"
                  placeholder="Search doctors by name or specialty"
                  value={doctorQuery}
                  onChange={e => setDoctorQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { /* triggers filtering via effect */ } }}
                  style={{ flex: 1, minWidth: 160 }}
                />
                <button className="btn btn-outline" onClick={() => { /* explicit search: effect already handles */ setDoctorQuery(doctorQuery); }}>Search</button>
                <button className="btn btn-light" onClick={() => setDoctorQuery('')}>Clear</button>
              </div>
              <div className="doctor-selection-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
              {filteredDoctors.map(doctor => (
                <label key={doctor.id || doctor.user_id} className="doctor-option" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', background: selectedDoctors.includes(doctor.id || doctor.user_id) ? '#f0f8ff' : 'transparent' }}>
                  <input
                    type="checkbox"
                    checked={selectedDoctors.includes(doctor.id || doctor.user_id)}
                    onChange={(e) => {
                      const doctorId = doctor.id || doctor.user_id;
                      if (e.target.checked) setSelectedDoctors(prev => [...prev, doctorId]);
                      else setSelectedDoctors(prev => prev.filter(id => id !== doctorId));
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{doctor.full_name || doctor.name || 'Doctor'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{doctor.specialist || doctor.specialty || 'General'}</div>
                  </div>
                </label>
              ))}
            </div>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>No doctors available at the moment.</p>
          )}
          {selectedDoctors.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              <strong>Selected: {selectedDoctors.length} doctor(s)</strong>
            </div>
          )}
  </div>
  </div>

            {/* Raw JSON display removed - questions are generated by AI only */}

        {/* Interview mode */}
        <div className="card" style={{ marginTop: 16 }}>
          {!interview.sessionId ? (
            <>
              <h3 className="card-title">Interview</h3>
              <p className="muted">Click "Start Interview" above to begin. You can type answers here once the first question appears.</p>
              <div className="form-group">
                <input
                  className="form-input"
                  value={iAnswer}
                  onChange={e => setIAnswer(e.target.value)}
                  placeholder="Type your answer"
                  disabled
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled>
                  Send Answer
                </button>
                <button className="btn btn-secondary" disabled>
                  Start Over
                </button>
                <button className="btn btn-secondary" disabled title="Generate a report after completing interview">
                  Generate Report
                </button>
              </div>
            </>
          ) : (!interview.done ? (
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
                <button className="btn btn-secondary" onClick={restartInterview} disabled={iLoading.next || iLoading.report}>
                  Start Over
                </button>
                <button className="btn btn-secondary" onClick={generateInterviewReport} disabled={iLoading.report} title="Finish now and generate a report">
                  {iLoading.report ? 'Generating…' : 'Generate Report'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="card-title">Interview Complete</h3>
              <p className="muted">Generate a final report based on your answers.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={restartInterview} disabled={iLoading.report}>
                  Start Over
                </button>
                <button className="btn btn-success" onClick={generateInterviewReport} disabled={iLoading.report}>
                  {iLoading.report ? 'Generating…' : 'Generate Report'}
                </button>
              </div>
            </>
          ))}
        </div>

        {/* Transcript */}
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

        {/* Legacy list mode */}
        {!interview.sessionId && questions.length === 0 ? (
          <div className="empty-state">
            {loading.generate ? (
              <div className="card" style={{ maxWidth: 720, margin: '0 auto', textAlign: 'left' }}>
                <h3 className="card-title">Generating Questionnaire…</h3>
                <div style={{ display:'grid', gap:16 }}>
                  {Array.from({ length: 5 }).map((_,i) => (
                    <div key={i} className="skeleton animate" style={{ height: 52, borderRadius: '0.75rem' }} />
                  ))}
                  <div className="skeleton animate" style={{ height: 12, width:'35%', borderRadius: '0.5rem' }} />
                </div>
              </div>
            ) : (
              <p>No questions yet. Click "Start Interview" for one-by-one adaptive questions.</p>
            )}
            {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
          </div>
        ) : (!interview.sessionId && (
          <>
            {/* Manual save removed — AI generates and (if configured) Test action persists automatically */}

            <div className="progress-container">
              <div className="progress-info">
                <span>Question {currentStep + 1} of {questions.length}</span>
                <span style={{ marginLeft: 12 }}>{questions.length ? Math.round(((currentStep + 1) / questions.length) * 100) : 0}% Complete</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="question-container">
              {loading.generate ? (
                <div style={{ display:'grid', gap:12 }}>
                  <div className="skeleton animate" style={{ height: 28, width:'60%', borderRadius:'0.75rem' }} />
                  <div className="skeleton animate" style={{ height: 96, width:'100%', borderRadius:'1rem' }} />
                </div>
              ) : (
                <>
                  <h2 className="question-text">{questions[currentStep]?.text}</h2>
                  {questions[currentStep] && renderQuestion(questions[currentStep])}
                </>
              )}
            </div>

            <div className="questionnaire-navigation">
              <div>
                <button
                  onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                  disabled={currentStep === 0}
                  className="btn btn-secondary"
                >
                  Previous
                </button>
              </div>
              
              <div>
                {currentStep === questions.length - 1 ? (
                  <button 
                    onClick={async () => { try { await generateReport(); } catch (_) {} finally { handleSubmit(); } }} 
                    className="btn btn-success"
                  >
                    Submit & Generate Report
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentStep(prev => Math.min(questions.length - 1, prev + 1))}
                    className="btn btn-primary"
                  >
                    Next
                  </button>
                )}
              </div>

            </div>

            {report && (
              <div className="card report-container">
                <h3 className="card-title">AI Health Report</h3>
                <pre className="report-content">{report}</pre>
              </div>
            )}
          </>
        ))}

        {/* Interview-generated report view */}
        {interview.sessionId && report && (
          <div className="card report-container" style={{ marginTop: 16 }}>
            <h3 className="card-title">AI Health Report</h3>
            <pre className="report-content">{report}</pre>
          </div>
        )}
      </div>
    </main>
  );
}

function SensorDataPage() {
  const [vitalsData] = useState([
    { time: "08:00", temp: 98.5, pulse: 72, spo2: 98 },
    { time: "12:00", temp: 98.6, pulse: 74, spo2: 97 },
    { time: "16:00", temp: 98.4, pulse: 73, spo2: 98 },
    { time: "20:00", temp: 98.7, pulse: 75, spo2: 99 }
  ]);

  useEffect(() => {
    try { 
      window.localStorage.setItem('vitals_data', JSON.stringify(vitalsData)); 
    } catch (e) {}
  }, [vitalsData]);

  return (
    <main className="route-screen">
      <div className="card animate-fade-in">
        <h1 className="card-title">Sensor Data Monitoring</h1>
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Current Temperature</h3>
            <div className="value">98.6°F</div>
          </div>
          <div className="dashboard-card">
            <h3>Current Heart Rate</h3>
            <div className="value">72 bpm</div>
          </div>
          <div className="dashboard-card">
            <h3>Current SpO2</h3>
            <div className="value">98%</div>
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">24-Hour Vitals Trend</h3>
          <div className="vitals-chart">
            {vitalsData.map((data, index) => (
              <div key={index} className="vitals-bar">
                <div 
                  className="bar" 
                  style={{ height: `${data.temp * 2}px` }}
                ></div>
                <div className="bar-label">{data.time}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="card">
          <h3 className="card-title">Device Status</h3>
          <div className="device-status">
            <div className="status-indicator connected"></div>
            <span>Connected - Last updated: Today, 20:15</span>
          </div>
        </div>
      </div>
    </main>
  );
}


function ProfilePage() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [profileData, setProfileData] = useState({
    fullName: "",
    email: "",
    phone: "",
    dob: "",
    address: "",
    patientId: null
  });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured

  // Check Raspberry Pi device connectivity via /health endpoint
  const checkDevice = async () => {
    const base = process.env.REACT_APP_RPI_API_BASE;
    if (!base) {
      setDeviceStatus('not-configured');
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setDeviceStatus(res.ok ? 'connected' : 'offline');
    } catch (_) {
      setDeviceStatus('offline');
    }
  };

  useEffect(() => {
    // initial device check on mount
    checkDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPatientProfile = useCallback(async () => {
    if (!auth.session?.user?.id) return;

    try {
      const patientProfileData = {
        user_id: auth.session.user.id,
        full_name: auth.profile?.full_name || "",
        phone: "",
        date_of_birth: null,
        address: "",
        medical_history: "",
        current_medications: ""
      };

      const { data: newProfile, error } = await supabase
        .from('patient_profiles')
        .insert([patientProfileData])
        .select()
        .single();

      if (newProfile && !error) {
        setProfileData({
          fullName: newProfile.full_name || "",
          email: auth.session.user.email || "",
          phone: newProfile.phone || "",
          dob: newProfile.date_of_birth || "",
          address: newProfile.address || "",
          patientId: newProfile.id || null
        });
      } else {
        // Fallback to basic profile data if creation failed
        setProfileData({
          fullName: auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: "",
          dob: "",
          address: "",
          patientId: null
        });
      }
    } catch (err) {
      console.error('Error creating patient profile:', err);
      // Fallback to basic profile data
      setProfileData({
        fullName: auth.profile?.full_name || "",
        email: auth.session.user.email || "",
        phone: "",
        dob: "",
        address: "",
        patientId: null
      });
    }
  }, [auth.session, auth.profile]);

  const fetchPatientProfile = useCallback(async () => {
    if (!auth.session?.user?.id) return;

    setLoading(true);
    try {
      // Fetch patient profile from patient_profiles table
      const { data: patientProfile, error } = await supabase
        .from('patient_profiles')
        .select('*')
        .eq('user_id', auth.session.user.id)
        .single();

      if (patientProfile && !error) {
        setProfileData({
          fullName: patientProfile.full_name || auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: patientProfile.phone || "",
          dob: patientProfile.date_of_birth || "",
          address: patientProfile.address || "",
          patientId: patientProfile.id || null
        });
      } else {
        // If no patient profile exists, create one
        await createPatientProfile();
      }
    } catch (err) {
      console.error('Error fetching patient profile:', err);
      // Try to create a patient profile if fetch failed
      await createPatientProfile();
    } finally {
      setLoading(false);
    }
  }, [auth.session, auth.profile, createPatientProfile]);

  useEffect(() => {
    if (auth.session?.user) {
      fetchPatientProfile();
    }
  }, [auth.session, fetchPatientProfile]);

  const handleSave = async () => {
    if (!auth.session?.user?.id) return;

    setLoading(true);
    try {
      // Update basic profile in profiles table
      await supabase.from('profiles').upsert({
        id: auth.session.user.id,
        full_name: profileData.fullName
      });

      // Update or insert patient profile in patient_profiles table
      const patientProfileData = {
        user_id: auth.session.user.id,
        full_name: profileData.fullName,
        phone: profileData.phone,
        date_of_birth: profileData.dob,
        address: profileData.address
      };

      const { error } = await supabase
        .from('patient_profiles')
        .upsert(patientProfileData);

      if (error) {
        console.error('Patient profile update failed:', error);
      }

      // Mirror core fields into public.patients for unified patient listing
      try {
        await supabase.from('patients').upsert({
          user_id: auth.session.user.id,
          full_name: profileData.fullName,
          name: profileData.fullName,
          email: auth.session.user.email,
          phone: profileData.phone,
          address: profileData.address
        });
      } catch (e) {
        console.warn('patients upsert failed:', e?.message || e);
      }

      setEditing(false);
    } catch (err) {
      console.error('Profile update failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="route-screen">
      <div className="card animate-fade-in">
        <div className="profile-header">
          <h1 className="card-title">Profile Settings</h1>
          {editing ? (
            <button 
              onClick={handleSave}
              className="btn btn-success"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          ) : (
            <button 
              onClick={() => setEditing(true)}
              className="btn btn-primary"
            >
              Edit Profile
            </button>
          )}
        </div>
        
        <div className="profile-grid">
          <div className="profile-section">
            <h3>Personal Information</h3>

            <div className="form-group">
              <label className="form-label">Device</label>
              <div className="form-display" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${deviceStatus === 'connected' ? 'success' : (deviceStatus === 'not-configured' ? '' : 'danger')}`}>
                  {deviceStatus === 'checking' && 'Checking...'}
                  {deviceStatus === 'connected' && 'Connected to device'}
                  {deviceStatus === 'offline' && 'Device offline'}
                  {deviceStatus === 'not-configured' && 'Device not configured'}
                </span>
                {deviceStatus !== 'checking' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={checkDevice}
                    title="Re-check device connection"
                  >
                    Re-check
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Patient ID (PID)</label>
              <div className="form-display" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#2563eb' }}>
                  {profileData.patientId ? `PID-${profileData.patientId}` : 'Not assigned yet'}
                </span>
                {profileData.patientId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`PID-${profileData.patientId}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch (_) {}
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              {editing ? (
                <input
                  type="text"
                  value={profileData.fullName}
                  onChange={e => setProfileData({...profileData, fullName: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.fullName}</div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <div className="form-display">{profileData.email}</div>
            </div>
            
            <div className="form-group">
              <label className="form-label">Phone</label>
              {editing ? (
                <input
                  type="tel"
                  value={profileData.phone}
                  onChange={e => setProfileData({...profileData, phone: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.phone || 'Not set'}</div>
              )}
            </div>
            
            <div className="form-group">
              <label className="form-label">Date of Birth</label>
              {editing ? (
                <input
                  type="date"
                  value={profileData.dob}
                  onChange={e => setProfileData({...profileData, dob: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.dob || 'Not set'}</div>
              )}
            </div>
            
            <div className="form-group">
              <label className="form-label">Address</label>
              {editing ? (
                <input
                  type="text"
                  value={profileData.address}
                  onChange={e => setProfileData({...profileData, address: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{profileData.address || 'Not set'}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function DoctorPortal() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingService, setUsingService] = useState(false);
  const [patientsCount, setPatientsCount] = useState(null);
  const [patientsCountMeta, setPatientsCountMeta] = useState(null);
  const initialLoadRef = useRef(false);

  const TBL_VITALS = process.env.REACT_APP_TBL_VITALS || 'vitals';
  const COL_TIME = process.env.REACT_APP_COL_TIME || 'time';

  const getRiskClass = (risk) => {
    switch (risk) {
      case "high": return "badge-high";
      case "medium": return "badge-medium";
      case "low": return "badge-low";
      default: return "";
    }
  };

  const fetchLatestVitalsTime = useCallback(async (userId) => {
    try {
      let q = await supabase.from(TBL_VITALS).select('*').eq('user_id', userId).order(COL_TIME, { ascending: false }).limit(1);
      if (q.error && /column|Could not find/i.test(q.error.message)) {
        q = await supabase.from(TBL_VITALS).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
      }
      if (q.error && /relation\s+"?vitals"?\s+does not exist/i.test(q.error.message) && TBL_VITALS === 'vitals') {
        let r2 = await supabase.from('vitales').select('*').eq('user_id', userId).order(COL_TIME, { ascending: false }).limit(1);
        if (r2.error && /column|Could not find/i.test(r2.error.message)) {
          r2 = await supabase.from('vitales').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
        }
        const row = (r2.data && r2.data[0]) || null;
        return row ? (row[COL_TIME] || row.created_at) : null;
      }
      const row = (q.data && q.data[0]) || null;
      return row ? (row[COL_TIME] || row.created_at) : null;
    } catch {
      return null;
    }
  }, [TBL_VITALS, COL_TIME]);

  // Batch fetch latest diagnosis per patient, returns a Map<user_id, {severity, created_at, ai_generated}>
  const fetchLatestDiagnosesMap = useCallback(async (userIds) => {
    const map = new Map();
    if (!Array.isArray(userIds) || !userIds.length) return map;
    try {
      // Pull recent diagnoses for these users and reduce to the latest per patient
      const { data, error } = await supabase
        .from(process.env.REACT_APP_TBL_REPORT || 'diagnoses')
        .select('patient_id,severity,created_at,ai_generated')
        .in('patient_id', userIds)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      for (const row of (data || [])) {
        const pid = row.patient_id;
        if (!pid) continue;
        if (!map.has(pid)) {
          map.set(pid, { severity: (row.severity || 'low'), created_at: row.created_at, ai_generated: !!row.ai_generated });
        }
      }
    } catch (_) {}
    // Secondary attempt: some rows might have been saved with internal patients.id instead of auth user_id
    if (map.size === 0) {
      try {
        const { data } = await supabase
          .from('patients')
          .select('id,user_id')
          .in('user_id', userIds)
          .limit(userIds.length);
        const idToUser = new Map((data || []).map(r => [r.id, r.user_id]));
        if (idToUser.size) {
          const { data: d2 } = await supabase
            .from(process.env.REACT_APP_TBL_REPORT || 'diagnoses')
            .select('patient_id,severity,created_at,ai_generated')
            .in('patient_id', Array.from(idToUser.keys()))
            .order('created_at', { ascending: false })
            .limit(1000);
          for (const row of (d2 || [])) {
            const mapped = idToUser.get(row.patient_id);
            const key = mapped || row.patient_id;
            if (!map.has(key)) {
              map.set(key, { severity: (row.severity || 'low'), created_at: row.created_at, ai_generated: !!row.ai_generated });
            }
          }
        }
      } catch (_) {}
    }
    return map;
  }, []);

  // Fetch patients from Supabase `patients` table (preferred DB source)
  const fetchPatientsFromSupabase = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('user_id, full_name, name, updated_at, created_at')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) return false;

      const userIds = rows.map(r => r.user_id).filter(Boolean);
      const diagMap = await fetchLatestDiagnosesMap(userIds);
      const list = [];
      for (const r of rows) {
        const lastTime = await fetchLatestVitalsTime(r.user_id);
        const latest = diagMap.get(r.user_id);
        const severity = latest?.severity || 'low';
        list.push({
          user_id: r.user_id,
          name: r.full_name || r.name || `(UID ${String(r.user_id).slice(0, 8)}…)`,
          condition: latest ? `Latest report ${latest.ai_generated ? '(AI)' : ''}` : '—',
          risk: typeof severity === 'string' ? severity.toLowerCase() : 'low',
          lastCheck: lastTime ? new Date(lastTime).toLocaleString() : '—'
        });
      }
      list.sort((a, b) => String(b.lastCheck).localeCompare(String(a.lastCheck)) || String(a.name).localeCompare(String(b.name)));
      setPatients(list);
      setUsingService(false);
      try {
        const map = Object.fromEntries((list || []).map(p => [String(p.user_id), p.name]));
        window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
      } catch (_) {}
      // Prefer exact count from patients table
      try {
        if (patientsCount == null) {
          const { count } = await supabase
            .from('patients')
            .select('id', { count: 'exact', head: true });
          if (count || count === 0) setPatientsCount(Number(count));
        }
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  }, [fetchLatestDiagnosesMap, fetchLatestVitalsTime, patientsCount]);

  const retryServiceFetch = useCallback(async () => {
    try {
      const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
      const health = await fetch(`${BASE}/health`);
      if (!health.ok) throw new Error('Service health not OK');

      // Prefer the richer list; fall back to /patients
      let list = [];
      try {
        const r1 = await fetch(`${BASE}/api/v1/patients-with-latest`);
        if (r1.ok) {
          const j1 = await r1.json();
          if (j1?.ok && Array.isArray(j1.patients)) list = j1.patients;
        }
      } catch (_) {}
      if (!list.length) {
        const r2 = await fetch(`${BASE}/api/v1/patients`);
        if (r2.ok) {
          const j2 = await r2.json();
          if (j2?.ok && Array.isArray(j2.patients)) list = j2.patients;
        }
      }
      if (list.length) {
        const baseList = list.map(p => ({
          user_id: p.user_id,
          name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
          condition: '—',
          risk: 'low',
          lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '—'
        }));
        // Enrich with diagnoses severity if available
        const ids = baseList.map(p => p.user_id).filter(Boolean);
        const diagMap = await fetchLatestDiagnosesMap(ids);
        const svcList = baseList.map(p => {
          const latest = diagMap.get(p.user_id);
          if (latest) {
            return { ...p, condition: `Latest report ${latest.ai_generated ? '(AI)' : ''}`, risk: (latest.severity || 'low').toLowerCase() };
          }
          return p;
        });
        setPatients(svcList);
        setUsingService(true);
        try {
          const map = Object.fromEntries(svcList.map(p => [String(p.user_id), p.name]));
          window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
        } catch (_) {}
        return true;
      }
      throw new Error('Service returned empty list');
    } catch (e) {
      setError(e?.message || String(e));
      return false;
    }
  }, [fetchLatestDiagnosesMap]);

  const refreshPatients = useCallback(async () => {
    const ok = await retryServiceFetch();
    if (!ok) {
      await fetchPatientsFromSupabase();
    }
  }, [retryServiceFetch, fetchPatientsFromSupabase]);

  useEffect(() => {
    if (initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = true;
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        // If a service endpoint is available, prefer it to bypass RLS and list all patients
        try {
          const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
          const health = await fetch(`${BASE}/health`);
          if (health.ok) {
            setUsingService(true);
            // Fetch total patients from profiles via service
            let svcCount = null;
            try {
              const cRes = await fetch(`${BASE}/api/v1/patient-count`);
              if (cRes.ok) {
                const cJson = await cRes.json();
                if (cJson?.ok) {
                  svcCount = Number(cJson.count || 0);
                  setPatientsCount(svcCount);
                  setPatientsCountMeta(cJson.counts || null);
                }
              }
            } catch (_) {}

            // Try patients-with-latest first
            let svcList = [];
            try {
              const resp = await fetch(`${BASE}/api/v1/patients-with-latest`);
              if (resp.ok) {
                const json = await resp.json();
                if (json?.ok && Array.isArray(json.patients)) {
                  svcList = json.patients.map(p => ({
                    user_id: p.user_id,
                    name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                    condition: '\u2014',
                    risk: 'low',
                    lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '\u2014'
                  }));
                }
              }
            } catch (_) {}

            // If service count suggests more patients than we received, fall back to /patients
            if ((svcCount != null) && (svcList.length < svcCount)) {
              try {
                const resp2 = await fetch(`${BASE}/api/v1/patients`);
                if (resp2.ok) {
                  const json2 = await resp2.json();
                  if (json2?.ok && Array.isArray(json2.patients)) {
                    const list2 = json2.patients.map(p => ({
                      user_id: p.user_id,
                      name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                      condition: '—',
                      risk: 'low',
                      lastCheck: '—'
                    }));
                    if (list2.length > svcList.length) svcList = list2;
                  }
                }
              } catch (_) {}
            }

            if (svcList.length) {
              if (mounted) {
                setPatients(svcList);
                // Persist a simple map of user_id -> name for detail page fallback
                try {
                  const map = Object.fromEntries((svcList || []).map(p => [String(p.user_id), p.name]));
                  window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
                } catch (_) {}
              }
              // Early return: service provided list; avoid browser fallback that might be limited by RLS
              return;
            } else {
              // If service is up but empty list, continue to browser fallback below
              setUsingService(false);
            }
          }
        } catch (_) {
          // ignore service errors and fall back to Supabase
        }

        // Try dedicated patients table first
        const okPatients = await fetchPatientsFromSupabase();
        if (okPatients) {
          return;
        }

        const { data, error } = await supabase
          .from('patient_profiles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        const ppList = Array.isArray(data) ? data : [];

        // Also load profiles to include patients without a patient_profiles row
        let profsAll = [];
        try {
          const { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id,email,full_name,role')
            .limit(500);
          if (!pErr) profsAll = profs || [];
        } catch (_) {}

        // Build a map of candidates by user_id
        const byId = new Map();
        for (const p of ppList) {
          if (!p?.user_id) continue;
          byId.set(p.user_id, { source: 'patient_profiles', user_id: p.user_id, full_name: p.full_name, email: null, role: 'patient' });
        }
        for (const pr of profsAll) {
          if (!pr?.id) continue;
          // If role column exists and is not 'patient', skip adding as patient
          if (typeof pr.role === 'string' && pr.role && pr.role.toLowerCase() !== 'patient') {
            // Keep existing entry if already present from patient_profiles
            if (!byId.has(pr.id)) continue;
          }
          if (!byId.has(pr.id)) {
            byId.set(pr.id, { source: 'profiles', user_id: pr.id, full_name: pr.full_name, email: pr.email, role: pr.role || null });
          } else {
            const cur = byId.get(pr.id);
            // Prefer profiles.full_name over patient_profiles.full_name
            byId.set(pr.id, { ...cur, email: pr.email ?? cur.email, full_name: pr.full_name || cur.full_name });
          }
        }

        // Enrich with latest vitals time and friendly name
        const candidates = Array.from(byId.values());
        const enriched = [];
        for (const c of candidates) {
          const lastTime = await fetchLatestVitalsTime(c.user_id);
          enriched.push({
            user_id: c.user_id,
            name: c.full_name || c.email || `(UID ${String(c.user_id).slice(0, 8)}…)`,
            condition: '—',
            risk: 'low',
            lastCheck: lastTime ? new Date(lastTime).toLocaleString() : '—'
          });
        }
        // Sort by lastCheck desc then name
        enriched.sort((a, b) => String(b.lastCheck).localeCompare(String(a.lastCheck)) || String(a.name).localeCompare(String(b.name)));
        let finalList = enriched;

        // If we only received a small subset (likely due to RLS), try service fallback
        if (finalList.length <= 1) {
          try {
            const BASE = (process.env.REACT_APP_VITALS_WRITER_URL || process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
            const resp = await fetch(`${BASE}/api/v1/patients-with-latest`);
            if (resp.ok) {
              const json = await resp.json();
              if (json?.ok && Array.isArray(json.patients) && json.patients.length > finalList.length) {
                finalList = json.patients.map(p => ({
                  user_id: p.user_id,
                  name: p.full_name || p.name || p.email || `(UID ${String(p.user_id).slice(0, 8)}…)`,
                  condition: '—',
                  risk: 'low',
                  lastCheck: p.lastCheck ? new Date(p.lastCheck).toLocaleString() : '—'
                }));
                setUsingService(true);
              }
            } else {
              // surface partial info
              const txt = await resp.text().catch(() => '');
              console.warn('Service patients fetch failed:', resp.status, txt);
            }
          } catch (svcErr) {
            console.warn('Service patients fetch error:', svcErr?.message || svcErr);
          }
        }

        if (mounted) setPatients(finalList);
        // Persist a simple map of user_id -> name for detail page fallback
        try {
          const map = Object.fromEntries((finalList || []).map(p => [String(p.user_id), p.name]));
          window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
        } catch (_) {}

        // Browser-side fallback: profiles count (role ilike 'patient') if service count not available
        try {
          if (patientsCount == null) {
            // Prefer patients table count if exists; otherwise fall back to profiles role
            let set = false;
            try {
              const { count: c } = await supabase.from('patients').select('id', { count: 'exact', head: true });
              if (mounted && (c || c === 0)) { setPatientsCount(Number(c)); set = true; }
            } catch (_) {}
            if (!set) {
              const { count: pCount } = await supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .ilike('role', 'patient');
              if (mounted && (pCount || pCount === 0)) setPatientsCount(Number(pCount));
            }
          }
        } catch (_) {}
      } catch (e) {
        if (mounted) setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [fetchLatestVitalsTime, fetchPatientsFromSupabase, patientsCount]);

  // Severity summary dashboard
  const severityCounts = patients.reduce((acc, p) => {
    if (p.risk === 'high') acc.high++;
    else if (p.risk === 'medium') acc.medium++;
    else acc.low++;
    return acc;
  }, { low: 0, medium: 0, high: 0 });

  if (loading) {
    return (
      <main>
        <section className="hero">
          <h1 className="hero-title">Doctor Dashboard</h1>
          <p className="hero-subtitle">Loading the latest patient data…</p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">Doctor Dashboard</h1>
        <p className="hero-subtitle">Patient overview, risk indicators, and quick access to clinical reviews.</p>
        <div className="hero-cta">
          <button className="btn btn-light" onClick={refreshPatients}>Refresh Patients</button>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-xl font-semibold">Total</div><div className="text-3xl font-extrabold">{patientsCount != null ? patientsCount : patients.length}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">High Risk</div><div className="text-3xl font-extrabold">{severityCounts.high}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Medium Risk</div><div className="text-3xl font-extrabold">{severityCounts.medium}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Low Risk</div><div className="text-3xl font-extrabold">{severityCounts.low}</div></div>
        </div>
        {usingService && (
          <div className="alert alert-info mt-4">Using service endpoint to bypass RLS for listing patients.</div>
        )}
        {patientsCountMeta && (
          <div className="muted mt-2 text-xs">profiles={patientsCountMeta.profilesRolePatient} · patient_profiles={patientsCountMeta.patientProfiles} · union={patientsCountMeta.unionDistinct}</div>
        )}
        {error && (<div className="alert alert-danger mt-2">{error}</div>)}
      </section>

      <section className="feature-grid">
        <div className="feature-card">
          <h3>Patients</h3>
          <p>Browse the latest patient list and open detailed views to add clinical notes.</p>
          <div className="mt-4"><button className="btn btn-primary" onClick={refreshPatients}>Sync</button></div>
        </div>
        <div className="feature-card">
          <h3>Analytics</h3>
          <p>Track risk distribution and activity across your panel at a glance.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
        <div className="feature-card">
          <h3>Reports</h3>
          <p>Review AI reports generated from recent patient assessments.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
      </section>

      <div className="card mt-8">
        <h3 className="card-title">Patient List</h3>
        {patientsCount != null && patients.length < patientsCount && (
          <div className="alert alert-warning mb-3">
            Showing {patients.length} of {patientsCount} patients. Some results may be hidden by RLS.
            <button className="btn btn-outline ml-2" onClick={retryServiceFetch}>Try service again</button>
          </div>
        )}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Condition</th>
                <th>Risk Level</th>
                <th>Last Check</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {patients.map(patient => (
                <tr key={patient.user_id}>
                  <td>{patient.name}</td>
                  <td>{patient.condition}</td>
                  <td>
                    <span className={`badge ${getRiskClass(patient.risk)}`}>
                      {patient.risk}
                    </span>
                  </td>
                  <td>{patient.lastCheck}</td>
                  <td>
                    <Link 
                      className="btn btn-primary" 
                      to={`/doctor/patient/${patient.user_id}`} 
                      state={{ name: patient.name }}
                    >
                      View Details
                    </Link>
                    <button className="btn btn-success ml-2">
                      Add Feedback
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function AdminPortal() {
  const [users] = useState([
    { id: 1, name: "John Doe", role: "patient", email: "john@example.com", status: "active" },
    { id: 2, name: "Dr. Jane Smith", role: "doctor", email: "jane@example.com", status: "active" },
    { id: 3, name: "Admin User", role: "admin", email: "admin@example.com", status: "active" }
  ]);
  
  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">Admin Dashboard</h1>
        <p className="hero-subtitle">Manage users and monitor system status with a clean, modern UI.</p>
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-xl font-semibold">Users</div><div className="text-3xl font-extrabold">142</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Active</div><div className="text-3xl font-extrabold">24</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Status</div><div className="text-3xl font-extrabold text-emerald-500">Operational</div></div>
        </div>
      </section>

      <section className="feature-grid">
        <div className="feature-card">
          <h3>Users</h3>
          <p>Create and manage users and roles across the platform.</p>
          <div className="mt-4"><button className="btn btn-primary">Add User</button></div>
        </div>
        <div className="feature-card">
          <h3>Settings</h3>
          <p>Configure environment, branding, and integrations.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
        <div className="feature-card">
          <h3>Logs</h3>
          <p>View recent system events for troubleshooting.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
      </section>

      <div className="card mt-8">
        <h3 className="card-title">User Management</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Email</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>
                    <span className="badge">
                      {user.role}
                    </span>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className="badge success">
                      {user.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-primary">Edit</button>
                    <button className="btn btn-danger ml-2">Disable</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function App() {
  // Scroll-based parallax and reveal animations
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.pageYOffset;

      // Parallax effect for hero blobs
      const blobs = document.querySelectorAll('.hero-parallax-layer .blob');
      blobs.forEach((blob, index) => {
        const speed = index === 0 ? 0.3 : 0.2;
        const yPos = -(scrolled * speed);
        blob.style.transform = `translate3d(0px, ${yPos}px, 0px)`;
      });

      // Scroll reveal animations
      const reveals = document.querySelectorAll('.reveal');
      reveals.forEach((element) => {
        const elementTop = element.getBoundingClientRect().top;
        const elementVisible = 150;

        if (elementTop < window.innerHeight - elementVisible) {
          element.classList.add('visible');
        }
      });

      // Tilt effect on scroll
      const tilts = document.querySelectorAll('.tilt');
      tilts.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const mouseX = centerX;
        const mouseY = centerY + scrolled * 0.1;

        const rotateX = (mouseY - centerY) / rect.height * -10;
        const rotateY = (mouseX - centerX) / rect.width * 10;

        element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)`;
      });
    };

    // Throttle scroll events for better performance
    let ticking = false;
    const scrollHandler = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', scrollHandler, { passive: true });

    // Initial check for elements already in view
    handleScroll();

    return () => window.removeEventListener('scroll', scrollHandler);
  }, []);

  return (
    <AuthProvider>
      <ThemeProvider>
        <Router>
          <div className="app-container flex flex-col min-h-screen">
            <HealthBackground />
            <SensorIconsBackground count={36} opacity={0.28} />
            <div className="flex-1 flex flex-col" id="main">
              <Header />
              <FloatingDocAssistant />
              <ScrollToTop />
              <div className="flex-1">
                <RouteTransitionWrapper>
                  {(displayLocation) => (
                    <Routes location={displayLocation}>
              <Route path="/" element={<HomePage />} />
          {/** Interview mode is now part of QuestionnairePage; route removed */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              
              <Route path="/patient" element={
                <ProtectedRoute role="patient">
                  <PatientPortal />
                </ProtectedRoute>
              } />
              <Route path="/patient/vitals" element={
                <ProtectedRoute role="patient">
                  <VitalsPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/questionnaire" element={
                <ProtectedRoute role="patient">
                  <QuestionnairePage />
                </ProtectedRoute>
              } />
              <Route path="/patient/ai-questionnaires" element={
                <ProtectedRoute role="patient">
                  <Navigate to="/patient/questionnaire" replace />
                </ProtectedRoute>
              } />
              <Route path="/patient/sensor-data" element={
                <ProtectedRoute role="patient">
                  <SensorDataPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/uploads" element={
                <ProtectedRoute role="patient">
                  <UploadDocumentsPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/profile" element={
                <ProtectedRoute role="patient">
                  <ProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/patient/doctors" element={
                <ProtectedRoute role="patient">
                  <DoctorDirectoryPage />
                </ProtectedRoute>
              } />
              <Route path="/patient/doctors/:id" element={
                <ProtectedRoute role="patient">
                  <DoctorPublicProfilePage />
                </ProtectedRoute>
              } />
              
              <Route path="/doctor" element={
                <ProtectedRoute role="doctor">
                  <DoctorPortal />
                </ProtectedRoute>
              } />
              <Route path="/doctor/profile" element={
                <ProtectedRoute role="doctor">
                  <DoctorProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/doctor/notifications" element={
                <ProtectedRoute role="doctor">
                  <DoctorNotificationsPage />
                </ProtectedRoute>
              } />
              <Route path="/doctor/patient/:id" element={
                <ProtectedRoute role="doctor">
                  <DoctorPatientView />
                </ProtectedRoute>
              } />
              
              <Route path="/admin" element={
                <ProtectedRoute role="admin">
                  <AdminPortal />
                </ProtectedRoute>
              } />
                    </Routes>
                  )}
                </RouteTransitionWrapper>
              </div>
              <Footer />
            </div>
          </div>
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
}

// Re-export auth hook so layout components (Sidebar, etc.) can consume without circular complexity
export { useAuth };
export default App;
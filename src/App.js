import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
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
import AIQuestionnairesPage from './components/AIQuestionnairesPage';
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
- Antipyretics if fever > 101 F
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
        t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
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
          await supabase
            .from('patients')
            .upsert(
              {
                user_id: userId,
                full_name,
                name: full_name,
                email
              },
              { onConflict: 'user_id' }
            )
            .select();
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
          await supabase
            .from('patients')
            .upsert(
              {
                user_id: userId,
                full_name: upserted?.full_name || full_name,
                name: upserted?.full_name || full_name,
                email
              },
              { onConflict: 'user_id' }
            )
            .select();
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
  const navigate = useNavigate();

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
          <span className="logo-icon" aria-hidden>SD</span>
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
            {theme === 'dark' ? 'Dark Theme' : 'Light Theme'}
          </button>
          <button
            className="btn btn-outline"
            aria-label={animEnabled ? 'Disable animations' : 'Enable animations'}
            title={animEnabled ? 'Disable animations' : 'Enable animations'}
            onClick={() => setAnimEnabled(a => !a)}
          >
            {animEnabled ? 'Anim On' : 'Anim Off'}
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
          Experience <span className="hero-gradient">next-gen healthcare</span>
        </h1>
        <p className="hero-subtitle">
          One platform for patients, doctors, and admins - AI-assisted, privacy-first, and designed with care.
        </p>
        <div className="hero-cta">
          <Link to="/signup" className="btn btn-primary">Create account</Link>
          <Link to="/login" className="btn btn-light">Sign in</Link>
        </div>
        {auth.session && (
          <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">
            Signed in as <strong>{auth.profile?.full_name}</strong> | Role: <span className="badge">{auth.profile?.role}</span>
          </div>
        )}
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-2xl font-extrabold">99.9%</div><div className="muted">Uptime</div></div>
          <div className="hero-stat"><div className="text-2xl font-extrabold">HIPAA-minded</div><div className="muted">Privacy</div></div>
          <div className="hero-stat"><div className="text-2xl font-extrabold">AI-assisted</div><div className="muted">Workflows</div></div>
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
          <p>See patient overviews, review AI-generated reports, and add clinical feedback efficiently.</p>
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
            {auxLoading.magic ? 'Sending...' : 'Login via Magic Link'}
          </button>
          <button
            className="btn btn-outline"
            onClick={resendConfirmation}
            disabled={auxLoading.resend}
            title="Resend email confirmation"
          >
            {auxLoading.resend ? 'Resending...' : 'Resend Confirmation Email'}
          </button>
          <button
            className="btn btn-outline"
            onClick={requestPasswordReset}
            disabled={auxLoading.reset}
            title="Send a password reset link to your email"
          >
            {auxLoading.reset ? 'Sending...' : 'Forgot Password? Reset'}
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
            {loading ? 'Updating...' : 'Update Password'}
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
  const [vitalsStatus, setVitalsStatus] = useState('offline'); // offline, measuring, measured
  const [vitalsTimestamp, setVitalsTimestamp] = useState(null);
  const [latestVitals, setLatestVitals] = useState({ temperature: null, heartRate: null, spo2: null, timestamp: null });
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  // Helper function to calculate data freshness
  const calculateDataFreshness = (timestamp) => {
    if (!timestamp) return 'old';

    const ts = typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
    if (!ts || Number.isNaN(ts)) return 'old';

    const diffInMinutes = (Date.now() - ts) / (1000 * 60);

    if (diffInMinutes < 5) {
      return 'fresh';  // Less than 5 minutes old
    } else if (diffInMinutes < 30) {
      return 'stale';  // Less than 30 minutes old
    } else {
      return 'old';    // 30 minutes or older
    }
  };

  // Helper function to format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    // Initialize status indicators when component mounts
    setVitalsStatus('offline');
  }, []);

  useEffect(() => {
    let isMounted = true;

    const coerceNumber = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.round(num * 10) / 10;
    };

    const applySnapshot = (snapshot) => {
      if (!snapshot || !isMounted) return;
      setLatestVitals((prev) => {
        const merged = {
          temperature: snapshot.temperature ?? prev.temperature ?? null,
          heartRate: snapshot.heartRate ?? prev.heartRate ?? null,
          spo2: snapshot.spo2 ?? prev.spo2 ?? null,
          timestamp: snapshot.timestamp || prev.timestamp || null
        };
        const hasData = merged.temperature != null || merged.heartRate != null || merged.spo2 != null;
        setVitalsStatus(hasData ? 'measured' : 'offline');
        if (merged.timestamp) setVitalsTimestamp(merged.timestamp);
        return merged;
      });
    };

    const hydrateFromLocalStorage = () => {
      if (typeof window === 'undefined') return;
      const keys = ['vitalsData', 'vitals_data'];
      for (const key of keys) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!parsed) continue;
          if (Array.isArray(parsed)) {
            const latest = parsed[parsed.length - 1];
            if (!latest) continue;
            applySnapshot({
              temperature: coerceNumber(latest.temperature ?? latest.temp ?? latest.object_temp_F ?? latest.object_temp_C ?? latest.body_temp),
              heartRate: coerceNumber(latest.heartRate ?? latest.heart_rate ?? latest.pulse),
              spo2: coerceNumber(latest.spo2 ?? latest.spo2_percent ?? latest.oxygen),
              timestamp: latest.timestamp || latest.time || null
            });
            return;
          }
          applySnapshot({
            temperature: coerceNumber(parsed.temperature?.value ?? parsed.temperature ?? parsed.temp),
            heartRate: coerceNumber(parsed.heartRate?.value ?? parsed.heartRate ?? parsed.heart_rate ?? parsed.pulse),
            spo2: coerceNumber(parsed.spo2?.value ?? parsed.spo2 ?? parsed.spo2_percent ?? parsed.oxygen),
            timestamp: parsed.temperature?.timestamp || parsed.heartRate?.timestamp || parsed.spo2?.timestamp || parsed.timestamp || null
          });
          return;
        } catch (err) {
          console.warn('Failed to parse cached vitals:', err);
        }
      }
    };

    hydrateFromLocalStorage();

    if (patientId) {
      (async () => {
        try {
          const { data, error } = await supabase
            .from('vitals')
            .select('temperature, heart_rate, spo2, created_at, updated_at')
            .eq('user_id', patientId)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!error && Array.isArray(data) && data.length > 0) {
            const row = data[0];
            applySnapshot({
              temperature: coerceNumber(row.temperature),
              heartRate: coerceNumber(row.heart_rate),
              spo2: coerceNumber(row.spo2),
              timestamp: row.created_at || row.updated_at || null
            });
          }
        } catch (err) {
          console.warn('Failed to load latest vitals:', err);
        }
      })();
    }

    return () => {
      isMounted = false;
    };
  }, [patientId]);

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

  const formatVitalValue = (value, unit) => {
    if (value === null || value === undefined) return '—';
    return `${value}${unit}`;
  };

  const freshnessState = calculateDataFreshness(vitalsTimestamp);
  const freshnessLabel = {
    fresh: 'Fresh (≤5m)',
    stale: 'Stale (≤30m)',
    old: 'Old (>30m)'
  }[freshnessState] || 'No recent data';

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    setFeedbackLoading(true);
    setFeedbackError('');
    (async () => {
      try {
        const { data, error } = await supabase
          .from('patient_feedback')
          .select('id, doctor_name, message, created_at')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (error) throw error;
        if (!cancelled) setFeedbackItems(data || []);
      } catch (fbErr) {
        if (!cancelled) {
          setFeedbackItems([]);
          setFeedbackError(fbErr?.message || 'Unable to load feedback right now.');
        }
      } finally {
        if (!cancelled) setFeedbackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return (
    <main>
  <section className="hero animate-fade-up">
        <h1 className="hero-title">Patient Overview</h1>
        <p className="hero-subtitle">Track real-time vitals, complete assessments, and generate AI health insights.</p>
        <div className="hero-cta">
          <button onClick={() => navigate('/patient/vitals')} className="btn btn-primary" disabled={!user}>Start Assessment</button>
        </div>
        {auth.profile?.full_name && (
          <div className="mt-6 text-sm text-slate-600 dark:text-slate-300 flex flex-wrap gap-2 items-center">
            <span>Signed in as <strong>{auth.profile.full_name}</strong></span>
            {patientId && <span className="badge">PID-{patientId.slice(0,8)}</span>}
            <span className={`badge ${deviceStatus === 'connected' ? 'success' : deviceStatus === 'offline' ? 'danger' : ''}`}>
              {deviceStatus === 'checking' ? 'Checking device...' : deviceStatus === 'connected' ? 'Device connected' : deviceStatus === 'offline' ? 'Device offline' : 'Not configured'}
            </span>
            <span className={`badge ${vitalsStatus === 'measured' ? 'success' : 'danger'}`}>
              {vitalsStatus === 'measured' ? 'Vitals synced' : 'No recent vitals'}
            </span>
          </div>
        )}
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="text-xl font-semibold">Temp</div>
            <div className="text-3xl font-extrabold">{formatVitalValue(latestVitals.temperature, ' °F')}</div>
          </div>
          <div className="hero-stat">
            <div className="text-xl font-semibold">Heart</div>
            <div className="text-3xl font-extrabold">{formatVitalValue(latestVitals.heartRate, ' bpm')}</div>
          </div>
          <div className="hero-stat">
            <div className="text-xl font-semibold">SpO2</div>
            <div className="text-3xl font-extrabold">{formatVitalValue(latestVitals.spo2, '%')}</div>
          </div>
        </div>
        <small className="muted" style={{ display: 'block', marginTop: '8px' }}>
          {latestVitals.timestamp
            ? `Last reading ${formatTimestamp(latestVitals.timestamp)} • ${vitalsStatus === 'measured' ? freshnessLabel : 'No recent data'}`
            : 'No vitals recorded yet'}
        </small>
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
      </section>

      <section className="card mt-8">
        <div className="aiq-section-header" style={{ marginBottom: '12px' }}>
          <div>
            <p className="aiq-eyebrow">Care guidance</p>
            <h2>Doctor Feedback</h2>
          </div>
          <span className="aiq-pill">{feedbackItems.length} note{feedbackItems.length === 1 ? '' : 's'}</span>
        </div>
        <p className="muted" style={{ marginBottom: '16px' }}>Your care team shares insights and next steps here.</p>
        {feedbackLoading ? (
          <div className="skeleton animate" style={{ height: 80, borderRadius: '1rem' }} />
        ) : feedbackError ? (
          <div className="alert alert-danger">{feedbackError}</div>
        ) : feedbackItems.length === 0 ? (
          <div className="aiq-empty-state">No feedback yet. Once a doctor shares guidance, it will appear here.</div>
        ) : (
          <ul className="aiq-context-list" style={{ gap: '12px' }}>
            {feedbackItems.map((item) => (
              <li key={item.id} className="aiq-subcard" style={{ marginTop: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div>
                    <strong>{item.doctor_name || 'Doctor'}</strong>
                    <p className="muted" style={{ marginTop: '4px' }}>{item.message}</p>
                  </div>
                  <small className="muted">{formatTimestamp(item.created_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
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
  const navigate = useNavigate();
  // Interview-mode state (AI-driven sequential Q&A)
  const [interview, setInterview] = useState({ sessionId: null, question: '', turns: [], done: false });
  const [iAnswer, setIAnswer] = useState('');
  const [iLoading, setILoading] = useState({ start: false, next: false, report: false });
  const [serverBase, setServerBase] = useState(SERVER_BASE);
  const [health, setHealth] = useState({ checked: false, ok: false, detail: '' });
  const LS_KEYS = { interview: 'interview_state_v1', base: 'api_server_base_v1', questionnaire: 'questionnaire_progress_v1', selectedDoctors: 'selected_doctors_v1' };

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
      const savedBase = window.localStorage.getItem(LS_KEYS.base);
      if (savedBase) setServerBase(savedBase);
    } catch (_) {}
    try {
      const raw = window.localStorage.getItem(LS_KEYS.interview);
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
      const rawSel = window.localStorage.getItem(LS_KEYS.selectedDoctors);
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
    try { window.localStorage.setItem(LS_KEYS.base, serverBase || ''); } catch (_) {}
  }, [serverBase]);
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEYS.interview, JSON.stringify({ ...interview, report })); } catch (_) {}
  }, [interview, report]);

  // Persist selected doctors so choices survive reloads/navigation
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEYS.selectedDoctors, JSON.stringify(selectedDoctors)); } catch (_) {}
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
  try { window.localStorage.setItem(LS_KEYS.interview, JSON.stringify({ sessionId: j.sessionId, question: j.question || '', turns: [], done: Boolean(j.done), report: '' })); } catch (_) {}
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
        window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(nextState));
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
        const raw = window.localStorage.getItem(LS_KEYS.interview);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.report = j.report || '';
        window.localStorage.setItem(LS_KEYS.interview, JSON.stringify(parsed));
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

  // runHealthCheck removed - kept in codebase but not exposed in UI

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    try { window.localStorage.setItem('questionnaireAnswers', JSON.stringify({ ...answers, [questionId]: value })); } catch (_) {}
  };

  // Questions are generated by AI and are read-only

  // Removed key management UI; keys are now server-side only

  async function generateQuestions() {
    setLoading(prev => ({ ...prev, generate: true }));
    setError('');
    
    try {
  // Collect context: recent vitals and uploaded document names for the current user
      let vitals = [];
      let uploads = [];

      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vitals_data') : null;
        vitals = stored ? JSON.parse(stored) : [];
      } catch (_) { vitals = []; }

      try {
        const uid = auth?.session?.user?.id;
        if (uid) {
          const { data } = await supabase
            .from('documents')
            .select('*')
            .eq('user_id', uid)
            .order('uploaded_at', { ascending: false })
            .limit(50);
          uploads = (data || []).map((doc) => ({
            id: doc.id,
            name: doc.original_name || doc.file_name || 'Document',
            summary: doc.extraction_summary || null,
            extractedText: doc.extracted_text || null,
            status: doc.extraction_status || 'pending'
          }));
        }
      } catch (_) {
        uploads = [];
      }

      try {
        const questions = await MedicalAI.generateQuestionnaire({ vitals, uploads });
        setQuestions(questions);
      } catch (e) {
        console.error('AI questionnaire generation failed:', e);
        setError(e?.message || 'AI questionnaire generation failed. Please check your OpenAI API key and try again.');
        setQuestions([]);
        // rethrow so caller (if any) can handle
        throw e;
      }
      setAnswers({});
      setReport('');
      setCurrentStep(0);
      try { window.localStorage.setItem('questionnaireAnswers', JSON.stringify({})); } catch (_) {}
    } catch (err) {
      setError(err.message || 'Failed to generate questions');
    } finally {
      setLoading(prev => ({ ...prev, generate: false }));
    }
  }

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
        const hasVitals = (() => {
          try {
            const vd = JSON.parse(window.localStorage.getItem('vitalsData') || window.localStorage.getItem('vitals_data') || 'null');
            return Boolean(vd && ((vd.temperature && vd.temperature.value != null) || (vd.heartRate && vd.heartRate.value != null) || (vd.spo2 && vd.spo2.value != null)));
          } catch (_) {
            return false;
          }
        })();

        let hasUploads = false;
        try {
          const cachedUploads = JSON.parse(window.localStorage.getItem('uploadedDocuments') || '[]');
          hasUploads = Array.isArray(cachedUploads) && cachedUploads.length > 0;
        } catch (_) {
          hasUploads = false;
        }

        if (!hasUploads) {
          try {
            const uid = auth?.session?.user?.id;
            if (uid) {
              const { data: docProbe } = await supabase
                .from('documents')
                .select('id')
                .eq('user_id', uid)
                .limit(1);
              hasUploads = Array.isArray(docProbe) && docProbe.length > 0;
            }
          } catch (_) {
            hasUploads = false;
          }
        }

        const hasAnswers = (() => {
          try {
            const ans = JSON.parse(window.localStorage.getItem('questionnaireAnswers') || '{}') || {};
            return Object.values(ans).some(v => Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== ''));
          } catch (_) {
            return false;
          }
        })();

        if (!(hasVitals || hasUploads || hasAnswers)) {
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
            disabled={iLoading.start || selectedDoctors.length === 0}
            title={selectedDoctors.length === 0 ? "Please select at least one doctor first" : "Start Interview"}
            style={{ padding: '12px 28px', width: '100%', maxWidth: 420 }}
          >
            {iLoading.start ? 'Starting...' : 'Start Interview'}
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
        {interview.sessionId && (
          <div className="card" style={{ marginTop: 16 }}>
            {!interview.done ? (
              <>
                <h3 className="card-title">Interview</h3>
                <p style={{ fontSize: 18 }}>{interview.question || '...'}</p>
                <div className="form-group">
                  <input
                    className="form-input"
                    value={iAnswer}
                    onChange={e => setIAnswer(e.target.value)}
                    placeholder="Type your answer"
                    onKeyDown={(e) => { if (e.key === 'Enter') sendInterviewAnswer(); }}
                  />
                </div>
                <button className="btn btn-primary" onClick={sendInterviewAnswer} disabled={iLoading.next || !iAnswer.trim()}>
                  {iLoading.next ? 'Sending...' : 'Send Answer'}
                </button>
              </>
            ) : (
              <>
                <h3 className="card-title">Interview Complete</h3>
                <p className="muted">Generate a final report based on your answers.</p>
                <button className="btn btn-success" onClick={generateInterviewReport} disabled={iLoading.report}>
                  {iLoading.report ? 'Generating...' : 'Generate Report'}
                </button>
              </>
            )}
          </div>
        )}

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
                <h3 className="card-title">Generating Questionnaire...</h3>
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
            {/* Manual save removed - AI generates and (if configured) Test action persists automatically */}

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
            <div className="value">98.6 F</div>
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
    age: "",
    dob: "",
    address: "",
    gender: "",
    patientId: null
  });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('checking'); // checking | connected | offline | not-configured

  useEffect(() => {
    if (auth.session?.user) {
      fetchPatientProfile();
    }
  }, [auth.session]);

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

  const normalizePhone = (row = {}) => {
    return row.phone || row.contact || row.contact_number || row.phone_number || row.mobile || "";
  };

  const normalizeGender = (row = {}) => {
    const g = row.gender || row.sex || row.gender_identity || row.patient_gender;
    return g ? String(g).toLowerCase() : "";
  };

  const normalizeDob = (row = {}) => {
    return row.date_of_birth || row.dob || row.birth_date || row.birthdate || "";
  };

  const mapPatientRowToProfileData = (row) => {
    const normalizedDob = normalizeDob(row);
    const normalizedAge = row?.age ?? row?.patient_age ?? computeAgeFromDob(normalizedDob);
    const normalizedPhone = normalizePhone(row);
    const normalizedGender = normalizeGender(row);
    const normalizedPatientId = row?.patient_id || row?.id || null;
    return {
      fullName: row?.full_name || row?.name || auth.profile?.full_name || "",
      email: row?.email || auth.session?.user?.email || "",
      phone: normalizedPhone,
      age: normalizedAge != null ? String(normalizedAge) : "",
      dob: normalizedDob,
      address: row?.address || "",
      gender: normalizedGender,
      patientId: normalizedPatientId
    };
  };

  const syncPublicPatient = async (source = {}, options = {}) => {
    if (!auth.session?.user?.id) return;
    const preserveExisting = options.preserveExisting ?? false;
    const normalizedName = source.fullName || source.full_name || profileData.fullName || auth.profile?.full_name || "";
    const normalizedAge = source.age ?? source.patient_age ?? profileData.age ?? "";
    const parsedAge = normalizedAge === "" ? null : Number(normalizedAge);

    const payload = {
      user_id: auth.session.user.id,
      full_name: normalizedName,
      name: normalizedName,
      email: source.email || profileData.email || auth.session.user.email || ""
    };

    const resolvedPhone = source.phone ?? source.contact ?? source.contact_number ?? source.phone_number ?? profileData.phone;
    if (!preserveExisting || resolvedPhone) {
      payload.phone = resolvedPhone || null;
    }

    const resolvedAddress = source.address ?? profileData.address;
    if (!preserveExisting || resolvedAddress) {
      payload.address = resolvedAddress || null;
    }

    const resolvedDob = source.dob ?? source.date_of_birth ?? source.birth_date ?? source.birthdate ?? profileData.dob;
    if (!preserveExisting || resolvedDob) {
      payload.date_of_birth = resolvedDob || null;
    }

    const resolvedGender = source.gender ?? source.sex ?? profileData.gender;
    const normalizedGenderValue = resolvedGender ? String(resolvedGender).toLowerCase() : null;
    if (!preserveExisting || normalizedGenderValue) {
      payload.gender = normalizedGenderValue;
    }

    if (!preserveExisting || Number.isFinite(parsedAge)) {
      payload.age = Number.isFinite(parsedAge) ? parsedAge : null;
    }

    if (source.device_status) {
      payload.device_status = source.device_status;
    }
    try {
      await supabase
        .from('patients')
        .upsert(payload, { onConflict: 'user_id' })
        .select();
    } catch (e) {
      console.warn('patients upsert failed:', e?.message || e);
    }
  };

  const loadLegacyPatientProfile = async () => {
    if (!auth.session?.user?.id) return false;
    try {
      const { data: patientProfile, error } = await supabase
        .from('patient_profiles')
        .select('*')
        .eq('user_id', auth.session.user.id)
        .maybeSingle();

      if (patientProfile && !error) {
        const legacyDob = patientProfile.date_of_birth || "";
        const legacyAge = patientProfile.age ?? computeAgeFromDob(legacyDob);
        setProfileData({
          fullName: patientProfile.full_name || auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: patientProfile.phone || "",
          age: legacyAge != null ? String(legacyAge) : "",
          dob: legacyDob,
          address: patientProfile.address || "",
          gender: normalizeGender(patientProfile),
          patientId: patientProfile.patient_id || patientProfile.id || null
        });
        await syncPublicPatient({
          fullName: patientProfile.full_name,
          phone: patientProfile.phone,
          address: patientProfile.address,
          dob: patientProfile.date_of_birth,
          gender: patientProfile.gender,
          age: legacyAge,
          patientId: patientProfile.patient_id || patientProfile.id || null
        }, { preserveExisting: true });
        return true;
      }
    } catch (legacyError) {
      console.error('Error fetching patient profile (legacy table):', legacyError);
    }
    return false;
  };

  const fetchPatientRowViaRpc = async () => {
    try {
      const { data, error } = await supabase.rpc('get_patient_profile_for_current_user');
      if (error) {
        console.warn('RPC get_patient_profile_for_current_user failed:', error.message || error);
        return null;
      }
      if (Array.isArray(data) && data.length) {
        return data[0];
      }
    } catch (rpcErr) {
      console.warn('RPC get_patient_profile_for_current_user exception:', rpcErr?.message || rpcErr);
    }
    return null;
  };

  const fetchPatientProfile = async () => {
    if (!auth.session?.user?.id) return;

    setLoading(true);
    const selectColumns = 'id,user_id,full_name,name,email,phone,address,date_of_birth,age,device_status';
    const hydrateFromLegacy = async () => {
      const loaded = await loadLegacyPatientProfile();
      if (!loaded) {
        await createPatientProfile();
      }
    };

    try {
      let patientRow = null;
      let error = null;

      const { data: userMatch, error: userMatchError } = await supabase
        .from('patients')
        .select(selectColumns)
        .eq('user_id', auth.session.user.id)
        .maybeSingle();

      patientRow = userMatch || null;
      error = userMatchError || null;

      if (!patientRow && auth.session?.user?.email) {
        const { data: emailMatch, error: emailError } = await supabase
          .from('patients')
          .select(selectColumns)
          .eq('email', auth.session.user.email)
          .maybeSingle();

        if (emailMatch) {
          patientRow = emailMatch;
          if (!patientRow.user_id) {
            try {
              await supabase
                .from('patients')
                .update({ user_id: auth.session.user.id })
                .eq('id', patientRow.id);
              patientRow.user_id = auth.session.user.id;
            } catch (linkErr) {
              console.warn('Failed to link patient row to user_id:', linkErr?.message || linkErr);
            }
          }
        } else if (emailError && !error) {
          error = emailError;
        }
      }

      if (!patientRow) {
        patientRow = await fetchPatientRowViaRpc();
      }

      if (patientRow) {
        setProfileData(mapPatientRowToProfileData(patientRow));
        if (patientRow.device_status) {
          setDeviceStatus(patientRow.device_status);
        }
      } else {
        if (error) {
          console.warn('patients fetch error:', error.message || error);
        }
        await hydrateFromLegacy();
      }
    } catch (err) {
      console.error('Error fetching patient profile:', err);
      await hydrateFromLegacy();
    } finally {
      setLoading(false);
    }
  };

  const createPatientProfile = async () => {
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
        const createdDob = newProfile.date_of_birth || "";
        const createdAge = newProfile.age ?? computeAgeFromDob(createdDob);
        setProfileData({
          fullName: newProfile.full_name || "",
          email: auth.session.user.email || "",
          phone: newProfile.phone || "",
          age: createdAge != null ? String(createdAge) : "",
          dob: createdDob,
          address: newProfile.address || "",
          gender: normalizeGender(newProfile),
          patientId: newProfile.patient_id || newProfile.id || null
        });
        await syncPublicPatient({
          fullName: newProfile.full_name,
          phone: newProfile.phone,
          address: newProfile.address,
          dob: newProfile.date_of_birth,
          gender: newProfile.gender,
          age: createdAge,
          patientId: newProfile.patient_id || newProfile.id || null
        }, { preserveExisting: true });
      } else {
        // Fallback to basic profile data if creation failed
        setProfileData({
          fullName: auth.profile?.full_name || "",
          email: auth.session.user.email || "",
          phone: "",
          age: "",
          dob: "",
          address: "",
          gender: "",
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
        age: "",
        dob: "",
        address: "",
        gender: "",
        patientId: null
      });
    }
  };

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
        address: profileData.address,
        gender: profileData.gender || null
      };

      const { error } = await supabase
        .from('patient_profiles')
        .upsert(patientProfileData);

      if (error) {
        console.error('Patient profile update failed:', error);
      }

      await syncPublicPatient({
        fullName: profileData.fullName,
        phone: profileData.phone,
        address: profileData.address,
        dob: profileData.dob,
        gender: profileData.gender,
        age: profileData.age,
        patientId: profileData.patientId
      });

      setEditing(false);
    } catch (err) {
      console.error('Profile update failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fallbackAgeFromDob = computeAgeFromDob(profileData.dob);
  const displayAgeValue = profileData.age !== ""
    ? String(profileData.age)
    : (fallbackAgeFromDob != null ? String(fallbackAgeFromDob) : "");
  const formattedPatientId = profileData.patientId
    ? (String(profileData.patientId).startsWith('PID-')
      ? String(profileData.patientId)
      : `PID-${profileData.patientId}`)
    : '';
  const genderLabelMap = {
    male: 'Male',
    female: 'Female',
    other: 'Other',
    'prefer_not_to_say': 'Prefer not to say'
  };
  const displayGenderValue = profileData.gender
    ? (genderLabelMap[profileData.gender] || profileData.gender)
    : 'Not set';

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
                  {profileData.patientId ? formattedPatientId : 'Not assigned yet'}
                </span>
                {profileData.patientId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(formattedPatientId);
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
              <label className="form-label">Contact</label>
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
              <label className="form-label">Gender</label>
              {editing ? (
                <select
                  className="form-input"
                  value={profileData.gender}
                  onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              ) : (
                <div className="form-display">{displayGenderValue}</div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Age</label>
              {editing ? (
                <input
                  type="number"
                  min="0"
                  value={profileData.age}
                  onChange={e => setProfileData({...profileData, age: e.target.value})}
                  className="form-input"
                />
              ) : (
                <div className="form-display">{displayAgeValue || 'Not set'}</div>
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
  const auth = useAuth();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patientsCount, setPatientsCount] = useState(0);
  const [lastSynced, setLastSynced] = useState(null);
  const [feedbackTarget, setFeedbackTarget] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackAlert, setFeedbackAlert] = useState('');

  const TBL_VITALS = process.env.REACT_APP_TBL_VITALS || 'vitals';
  const COL_TIME = process.env.REACT_APP_COL_TIME || 'time';

  const getRiskClass = (risk) => {
    switch (risk) {
      case 'high': return 'badge-high';
      case 'medium': return 'badge-medium';
      case 'low':
      default:
        return 'badge-low';
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

  const fetchLatestDiagnosesMap = useCallback(async (userIds) => {
    const map = new Map();
    if (!Array.isArray(userIds) || !userIds.length) return map;
    try {
      const { data, error } = await supabase
        .from(TBL_REPORT)
        .select('patient_id,severity,created_at,ai_generated')
        .in('patient_id', userIds)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      for (const row of (data || [])) {
        const pid = row.patient_id;
        if (!pid || map.has(pid)) continue;
        map.set(pid, { severity: (row.severity || 'low'), created_at: row.created_at, ai_generated: !!row.ai_generated });
      }
    } catch (_) {}
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
            .from(TBL_REPORT)
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

  const loadSharedPatients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: shareRows, error: shareErr } = await supabase
        .from('notifications')
        .select('patient_id, created_at')
        .eq('doctor_id', user.id)
        .eq('type', 'report_shared')
        .order('created_at', { ascending: false })
        .limit(500);
      if (shareErr) throw shareErr;

      const sharedIds = Array.from(new Set((shareRows || []).map(row => row.patient_id).filter(Boolean)));
      if (!sharedIds.length) {
        setPatients([]);
        setPatientsCount(0);
        setLastSynced(new Date().toISOString());
        return;
      }

      const { data: patientRows, error: patientErr } = await supabase
        .from('patients')
        .select('user_id, full_name, name, updated_at, created_at')
        .in('user_id', sharedIds);
      if (patientErr) throw patientErr;

      const diagMap = await fetchLatestDiagnosesMap(sharedIds);
      const enriched = [];
      for (const r of (patientRows || [])) {
        const lastTime = await fetchLatestVitalsTime(r.user_id);
        const latest = diagMap.get(r.user_id);
        enriched.push({
          user_id: r.user_id,
          name: r.full_name || r.name || `(UID ${String(r.user_id).slice(0, 8)}...)`,
          condition: latest ? `Latest report ${latest.ai_generated ? '(AI)' : ''}` : '--',
          risk: typeof latest?.severity === 'string' ? latest.severity.toLowerCase() : 'low',
          lastCheck: lastTime ? new Date(lastTime).toLocaleString() : '--'
        });
      }

      enriched.sort((a, b) => String(b.lastCheck).localeCompare(String(a.lastCheck)) || String(a.name).localeCompare(String(b.name)));
      setPatients(enriched);
      setPatientsCount(enriched.length);
      setLastSynced(new Date().toISOString());
      try {
        const map = Object.fromEntries(enriched.map(p => [String(p.user_id), p.name]));
        window.localStorage.setItem('patientNamesMap', JSON.stringify(map));
      } catch (_) {}
    } catch (e) {
      setError(e?.message || String(e));
      setPatients([]);
      setPatientsCount(0);
    } finally {
      setLoading(false);
    }
  }, [fetchLatestDiagnosesMap, fetchLatestVitalsTime]);

  useEffect(() => {
    loadSharedPatients();
  }, [loadSharedPatients]);

  const refreshPatients = () => {
    loadSharedPatients();
  };

  const openFeedbackPanel = (patient) => {
    setFeedbackTarget(patient);
    setFeedbackMessage('');
    setFeedbackAlert('');
  };

  const handleSubmitFeedback = async (event) => {
    event.preventDefault();
    if (!feedbackTarget) {
      setFeedbackAlert('Select a patient first.');
      return;
    }
    const trimmed = feedbackMessage.trim();
    if (!trimmed) {
      setFeedbackAlert('Feedback cannot be empty.');
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackAlert('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const doctorName = auth?.profile?.full_name || user.email || 'Doctor';
      const payload = {
        patient_id: feedbackTarget.user_id,
        doctor_id: user.id,
        doctor_name: doctorName,
        message: trimmed,
        created_at: new Date().toISOString()
      };
      const { error: insertErr } = await supabase.from('patient_feedback').insert([payload]);
      if (insertErr) throw insertErr;
      try {
        await supabase.from('notifications').insert([{
          doctor_id: user.id,
          patient_id: feedbackTarget.user_id,
          type: 'doctor_feedback',
          message: trimmed.slice(0, 280),
          is_read: false
        }]);
      } catch (notifErr) {
        console.warn('Feedback notification failed:', notifErr?.message || notifErr);
      }
      setFeedbackAlert('Feedback sent successfully.');
      setFeedbackMessage('');
      setFeedbackTarget(null);
    } catch (fbErr) {
      setFeedbackAlert(fbErr?.message || 'Unable to send feedback right now.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const severityCounts = patients.reduce((acc, p) => {
    if (p.risk === 'high') acc.high++;
    else if (p.risk === 'medium') acc.medium++;
    else acc.low++;
    return acc;
  }, { low: 0, medium: 0, high: 0 });

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">Doctor Dashboard</h1>
        <p className="hero-subtitle">Only patients who explicitly shared their records appear in your panel.</p>
        <div className="hero-cta">
          <button className="btn btn-light" onClick={refreshPatients} disabled={loading}>
            {loading ? 'Syncing...' : 'Refresh Patients'}
          </button>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><div className="text-xl font-semibold">Shared</div><div className="text-3xl font-extrabold">{patientsCount}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">High Risk</div><div className="text-3xl font-extrabold">{severityCounts.high}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Medium Risk</div><div className="text-3xl font-extrabold">{severityCounts.medium}</div></div>
          <div className="hero-stat"><div className="text-xl font-semibold">Low Risk</div><div className="text-3xl font-extrabold">{severityCounts.low}</div></div>
        </div>
        {lastSynced && (
          <div className="muted mt-2 text-xs">Last synced {new Date(lastSynced).toLocaleString()}</div>
        )}
        {error && (<div className="alert alert-danger mt-2">{error}</div>)}
      </section>

      <section className="feature-grid">
        <div className="feature-card">
          <h3>Patients</h3>
          <p>Only patients who shared a report or questionnaire with you are listed here.</p>
          <div className="mt-4"><button className="btn btn-primary" onClick={refreshPatients} disabled={loading}>{loading ? 'Syncing...' : 'Sync'}</button></div>
        </div>
        <div className="feature-card">
          <h3>Analytics</h3>
          <p>Track risk distribution across your shared panel at a glance.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
        <div className="feature-card">
          <h3>Reports</h3>
          <p>Review AI reports generated from patient assessments that were shared with you.</p>
          <div className="mt-4"><span className="badge">Soon</span></div>
        </div>
      </section>

      <div className="card mt-8">
        <h3 className="card-title">Patient List</h3>
        {patients.length === 0 && !loading && (
          <div className="alert alert-info mb-3">
            No patients have shared their records with you yet. Ask patients to share a report from the assessments page.
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
                    <button className="btn btn-success ml-2" onClick={() => openFeedbackPanel(patient)}>
                      Add Feedback
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {feedbackTarget && (
          <div className="card mt-4">
            <h4 className="card-title">Send feedback to {feedbackTarget.name}</h4>
            <form onSubmit={handleSubmitFeedback}>
              <label className="form-label" htmlFor="doctor-feedback-text">Message</label>
              <textarea
                id="doctor-feedback-text"
                className="form-input"
                rows={4}
                placeholder="Summarize key guidance, next steps, or encouragement..."
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button type="submit" className="btn btn-primary" disabled={feedbackSubmitting}>
                  {feedbackSubmitting ? 'Sending…' : 'Send Feedback'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setFeedbackTarget(null); setFeedbackAlert(''); }}>
                  Cancel
                </button>
              </div>
              {feedbackAlert && (
                <p
                  className="muted"
                  style={{ marginTop: '8px', color: feedbackAlert.includes('successfully') ? 'var(--success)' : 'var(--danger)' }}
                >
                  {feedbackAlert}
                </p>
              )}
            </form>
          </div>
        )}
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
      const rate = scrolled * -0.5;

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
                  <AIQuestionnairesPage />
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


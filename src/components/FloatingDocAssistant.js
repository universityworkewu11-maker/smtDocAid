import React, { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Simple per-route instructional tips; could be extended to fetch dynamic content.
const ROUTE_TIPS = [
  { match: /^\/$/, tips: [
    'Welcome! Create an account or sign in to begin.',
    'Explore the portals below based on your role.',
    'Need help? I will guide you along the way.'
  ]},
  { match: /^\/patient$/, tips: [
    'Start with “Start Assessment” to record vitals.',
    'Upload documents to enrich AI reports.',
    'Complete the questionnaire for a detailed analysis.'
  ]},
  { match: /patient\/vitals$/, tips: [
    'Click “Take” for each vital and confirm when ready.',
    'All vitals confirmed? Proceed to document uploads.',
    'You can skip and return later if needed.'
  ]},
  { match: /patient\/uploads$/, tips: [
    'Drag & drop or click to add medical files.',
    'At least one document helps improve AI accuracy.',
    'Ready? Continue to the questionnaire.'
  ]},
  { match: /patient\/questionnaire$/, tips: [
    'Interview mode: one smart question at a time.',
    'List mode: answer then generate a report.',
    'Submit to save answers and create an AI report.'
  ]},
  { match: /^\/doctor$/, tips: [
    'Review patient risk indicators here.',
    'Open a patient to view detailed vitals & reports.',
    'Keep your public profile updated for patients.'
  ]},
  { match: /doctor\/patient\//, tips: [
    'Scroll for latest reports—newest at the top.',
    'Add feedback after reviewing AI output.',
    'Navigate back to dashboard for another patient.'
  ]},
  { match: /^\/doctor\/profile$/, tips: [
    'Complete specialty and location for visibility.',
    'Your bio helps patients choose you.',
    'Save changes regularly.'
  ]},
  { match: /^\/patient\/doctors$/, tips: [
    'Filter by specialty or location to narrow results.',
    'Open a profile to view doctor details.',
    'Contact via email if provided.'
  ]}
];

const STORAGE_KEY = 'floating_doc_assistant_state_v1';
const AI_CACHE_KEY = 'floating_doc_assistant_ai_cache_v1';
const AI_TTL_MS = 30 * 60 * 1000; // 30 minutes cache per route

// Derive backend base similarly to App.js logic (fallback to localhost in dev)
function resolveServerBase() {
  const env = (process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5001';
  }
  return '';
}

export default function FloatingDocAssistant() {
  const location = useLocation();
  const [visible, setVisible] = useState(true);
  const [idx, setIdx] = useState(0);
  const [tips, setTips] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiAbortRef = useRef(null);
  const dragRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });
  const dragState = useRef({ active: false, offX:0, offY:0 });
  const restoredRef = useRef(false);
  const [pos, setPos] = useState({ x: 16, y: 24 });

  // Load persisted state
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st) {
          if (typeof st.visible === 'boolean') setVisible(st.visible);
          if (typeof st.collapsed === 'boolean') setCollapsed(st.collapsed);
          if (Array.isArray(st.tips)) setTips(st.tips);
          if (Number.isFinite(st.idx)) setIdx(Math.max(0, Math.min(st.idx, (st.tips||[]).length-1)));
          if (st.position && Number.isFinite(st.position.x) && Number.isFinite(st.position.y)) {
            posRef.current = st.position;
            setPos(st.position);
            restoredRef.current = true;
          }
        }
      }
    } catch (_) {}
  }, []);

  // AI tips fetch & caching per route
  useEffect(() => {
    const path = location.pathname;
    setIdx(0);
    setAiError('');
    // Cancel any in-flight request
    if (aiAbortRef.current) {
      try { aiAbortRef.current.abort(); } catch (_) {}
    }
    aiAbortRef.current = new AbortController();
    const abortSignal = aiAbortRef.current.signal;

    // Attempt cached AI tips first
    let cached = null;
    try {
      const raw = window.localStorage.getItem(AI_CACHE_KEY);
      if (raw) {
        const map = JSON.parse(raw) || {};
        const entry = map[path];
        if (entry && entry.tips && Array.isArray(entry.tips) && entry.tips.length && (Date.now() - entry.ts) < AI_TTL_MS) {
          cached = entry.tips;
        }
      }
    } catch (_) {}

    if (cached) {
      setTips(cached);
      return; // Skip network call
    }

    // Build base fallback tips (used if AI fails)
    const match = ROUTE_TIPS.find(r => r.match.test(path));
    const fallbackTips = match ? match.tips : ['Navigate the app using the header — I will adapt tips as you move.'];
    setTips(fallbackTips); // optimistic initial set

    // Decide context type (doctor vs patient) for prompt refinement
    const isDoctor = /^\/doctor\b/.test(path);
    const isPatient = /^\/patient\b/.test(path);
    const roleLabel = isDoctor ? 'doctor' : (isPatient ? 'patient' : 'general user');

    const serverBase = resolveServerBase();
    if (!serverBase) {
      // No backend configured; keep fallback tips
      return;
    }
    setAiLoading(true);

    (async () => {
      try {
        const system = `You are a concise clinical guide assistant. Generate 3 to 5 short actionable tips for a ${roleLabel} viewing the route "${path}" of a healthcare web app. Each tip MUST be <= 90 characters, start with an imperative verb, and avoid redundant words. Output ONLY a valid JSON array of strings (no markdown, no extra keys).`;
        const body = {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: 'Return ONLY the JSON array now.' }
          ],
          temperature: 0.3,
          max_tokens: 300
        };
        const resp = await fetch(`${serverBase}/api/v1/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortSignal
        });
        const txt = await resp.text();
        if (!resp.ok) throw new Error(txt || `HTTP ${resp.status}`);
        let parsed = null;
        try { parsed = JSON.parse(txt).text || txt; } catch { parsed = txt; }
        // Attempt to parse JSON array from model output
        let tipsArr = [];
        try {
          const maybeJson = typeof parsed === 'string' ? parsed.trim() : parsed;
          // If server wrapped response, unwrap
          if (typeof maybeJson === 'string') {
            const firstBracket = maybeJson.indexOf('[');
            const lastBracket = maybeJson.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
              const slice = maybeJson.slice(firstBracket, lastBracket + 1);
              tipsArr = JSON.parse(slice);
            }
          } else if (Array.isArray(maybeJson)) {
            tipsArr = maybeJson;
          }
        } catch (_) {}
        tipsArr = Array.isArray(tipsArr) ? tipsArr.filter(t => typeof t === 'string' && t.trim().length).map(t => t.trim()) : [];
        if (!tipsArr.length) throw new Error('AI returned no valid tips array');
        setTips(tipsArr);
        // Cache result
        try {
          const raw = window.localStorage.getItem(AI_CACHE_KEY);
          const map = raw ? (JSON.parse(raw) || {}) : {};
          map[path] = { tips: tipsArr, ts: Date.now() };
          window.localStorage.setItem(AI_CACHE_KEY, JSON.stringify(map));
        } catch (_) {}
      } catch (e) {
        setAiError(e?.message || 'AI tips unavailable');
        // Keep fallback tips already set
      } finally {
        setAiLoading(false);
      }
    })();
  }, [location.pathname]);

  // Persist minimal state
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        visible, idx, tips, collapsed, position: posRef.current
      }));
    } catch (_) {}
  }, [visible, idx, tips, collapsed, pos]);

  // Do NOT early-return to keep hook order stable; render conditionally below instead.

  const nextTip = () => setIdx(i => (tips.length ? (i + 1) % tips.length : 0));
  const prevTip = () => setIdx(i => (tips.length ? (i - 1 + tips.length) % tips.length : 0));

  // Drag logic
  const onPointerDown = (e) => {
    const el = dragRef.current;
    if (!el) return;
    dragState.current.active = true;
    const rect = el.getBoundingClientRect();
    dragState.current.offX = e.clientX - rect.left;
    dragState.current.offY = e.clientY - rect.top;
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!dragState.current.active) return;
    const el = dragRef.current;
    if (!el) return;
    const rawX = e.clientX - dragState.current.offX;
    const rawY = e.clientY - dragState.current.offY;
    // Clamp to viewport so the assistant cannot be dragged off-screen (16px/24px padding)
    const maxX = Math.max(0, (window.innerWidth || 0) - 16 - el.offsetWidth);
    const maxY = Math.max(0, (window.innerHeight || 0) - 24 - el.offsetHeight);
    const x = Math.min(Math.max(0, rawX), maxX);
    const y = Math.min(Math.max(0, rawY), maxY);
    posRef.current = { x, y };
    setPos({ x, y });
  };
  const onPointerUp = () => { dragState.current.active = false; };

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // Ensure on-screen after mount and after any CSS/layout shifts
    const ensureVisible = () => {
      const el = dragRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const inView = rect.right > 8 && rect.left < (window.innerWidth - 8) && rect.bottom > 8 && rect.top < (window.innerHeight - 8);
      if (!inView) {
        posRef.current = { x: 16, y: 24 };
        setPos({ x: 16, y: 24 });
      }
    };
    const id = setTimeout(() => {
      ensureVisible();
      // On first mount with no restored position, place bottom-right by default
      const el = dragRef.current;
      if (el && !restoredRef.current) {
        const x = Math.max(16, (window.innerWidth || 0) - el.offsetWidth - 16);
        const y = Math.max(24, (window.innerHeight || 0) - el.offsetHeight - 24);
        posRef.current = { x, y };
        setPos({ x, y });
      }
    }, 0);
    window.addEventListener('resize', ensureVisible);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', ensureVisible);
    };
  }, []);

  // Track first render to play entrance animation once
  const firstMountRef = useRef(true);
  useEffect(() => {
    if (firstMountRef.current) {
      firstMountRef.current = false;
    }
  }, []);

  const flightClass = firstMountRef.current ? 'flight-in' : '';

  // (No AI interview flow; assistant shows per-route tips only)

  return (
    <>
      {!visible ? (
        <button
          aria-label="Open Doc Guide"
          title="Open Doc Guide"
          onClick={() => setVisible(true)}
          style={{ position: 'fixed', left: 16, bottom: 24, zIndex: 9999 }}
          className="assistant-reopen"
        >
          🩺
        </button>
      ) : (
        <div
          ref={dragRef}
          className={`floating-assistant ${collapsed ? 'collapsed' : ''} ${flightClass}`}
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999 }}
        >
          <div
            className="assistant-avatar"
            onPointerDown={onPointerDown}
            onClick={(e) => {
              // If a drag wasn't initiated (quick click), toggle visibility (hide) or collapse
              // Use a small movement threshold to distinguish drag vs click
              if (dragState.current.active) return; // active means pointerdown already started a drag
              // Toggle hide on avatar click
              setVisible(false);
              e.stopPropagation();
            }}
            title="Drag or click to hide"
          >
            🩺
            <div className="assistant-badge" aria-hidden>
              {tips.length ? idx + 1 : 0}/{tips.length}
            </div>
          </div>
          <div className="assistant-content">
            <div className="assistant-header">
              <strong>Doc Guide</strong>
              <div className="assistant-actions">
                <button
                  className="assistant-btn"
                  onClick={() => setCollapsed((c) => !c)}
                  title={collapsed ? 'Expand' : 'Collapse'}
                >
                  {collapsed ? '▢' : '—'}
                </button>
              </div>
            </div>
            {!collapsed && (
              <>
                <div className="assistant-tip" key={idx}>
                  {aiLoading ? 'Loading AI tips…' : (tips[idx] || '')}
                </div>
                {aiError && !aiLoading && (
                  <div className="assistant-error" style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>
                    {aiError}
                  </div>
                )}
                <div className="assistant-nav">
                  <button className="assistant-btn" onClick={prevTip} disabled={tips.length < 2} aria-label="Previous tip">◀</button>
                  <button className="assistant-btn" onClick={nextTip} disabled={tips.length < 2} aria-label="Next tip">▶</button>
                </div>
                <div className="assistant-footer">
                  <button
                    className="assistant-btn"
                    onClick={() => { setIdx(0); }}
                    title="Reset tips"
                  >Reset</button>
                  <button
                    className="assistant-btn"
                    onClick={() => {
                      // Force refresh ignoring cache
                      try {
                        const raw = window.localStorage.getItem(AI_CACHE_KEY);
                        if (raw) {
                          const map = JSON.parse(raw) || {};
                          delete map[location.pathname];
                          window.localStorage.setItem(AI_CACHE_KEY, JSON.stringify(map));
                        }
                      } catch (_) {}
                      // trigger effect by tweaking path artificially via state changes (set tips empty first)
                      setTips([]);
                      setIdx(0);
                      // Re-run effect manually by updating a dummy state or just relying on path staying same; simplest: dispatch a synthetic popstate
                      const evt = new Event('popstate');
                      window.dispatchEvent(evt);
                    }}
                    disabled={aiLoading}
                    title="Refetch AI tips"
                  >↻</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

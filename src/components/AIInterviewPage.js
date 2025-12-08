import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function AIInterviewPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [turns, setTurns] = useState([]); // {q, a}
  const [loading, setLoading] = useState({ start: false, next: false, report: false });
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Optionally auto-start interview on mount
    // startInterview();
  }, []);

  async function buildContext() {
    // Collect recent vitals and uploaded filenames to prime the AI
    let vitals = [];
    let uploads = [];
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vitals_data') : null;
      vitals = stored ? JSON.parse(stored) : [];
    } catch (_) {}
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      if (uid) {
        const bucket = process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
        const { data } = await supabase.storage.from(bucket).list(uid, { limit: 50 });
        uploads = (data || []).map(i => i.name);
      }
    } catch (_) {}
    return { vitals, uploads };
  }

  async function startInterview() {
    setLoading(prev => ({ ...prev, start: true }));
    setError('');
    setReport('');
    setTurns([]);
    setDone(false);
    try {
      const context = await buildContext();
      const resp = await fetch('/api/v1/ai/interview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context })
      });
      const j = await resp.json();
      if (!resp.ok || !j.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      setSessionId(j.sessionId);
      setQuestion(j.question || '');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(prev => ({ ...prev, start: false }));
    }
  }

  async function sendAnswer() {
    if (!sessionId) return;
    const a = String(answer || '').trim();
    if (!a) return;
    setLoading(prev => ({ ...prev, next: true }));
    setError('');
    try {
      const resp = await fetch('/api/v1/ai/interview/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, answer: a })
      });
      const j = await resp.json();
      if (!resp.ok || !j.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      setTurns(prev => [...prev, { q: question, a }]);
      setAnswer('');
      setDone(Boolean(j.done));
      setQuestion(j.done ? '' : (j.question || ''));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(prev => ({ ...prev, next: false }));
    }
  }

  async function generateReport() {
    if (!sessionId) return;
    setLoading(prev => ({ ...prev, report: true }));
    setError('');
    try {
      const resp = await fetch('/api/v1/ai/interview/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const j = await resp.json();
      if (!resp.ok || !j.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      setReport(j.report || '');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(prev => ({ ...prev, report: false }));
    }
  }

  function restartInterview() {
    setSessionId(null);
    setQuestion('');
    setAnswer('');
    setTurns([]);
    setReport('');
    setDone(false);
    setError('');
  }

  return (
    <main>
      <div className="card">
        <div className="questionnaire-header">
          <h1 className="card-title">AI Interview</h1>
          <div className="questionnaire-actions">
            <button className="btn btn-primary" onClick={startInterview} disabled={loading.start}>
              {loading.start ? 'Starting…' : 'Start Interview'}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {!sessionId && (
          <p className="muted">Click Start to begin a one-by-one interview. Each next question depends on your last answer.</p>
        )}
      </div>

      <div className="interview-workspace">
        <div className="interview-main">
          {sessionId && !done && (
            <div className="card interview-question-section">
              <h3 className="card-title">Question</h3>
              <p style={{ fontSize: 18 }}>{question || '…'}</p>
              <div className="question-input-container">
                <div className="form-group">
                  <input
                    className="form-input"
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    placeholder="Type your answer"
                    onKeyDown={(e) => { if (e.key === 'Enter') sendAnswer(); }}
                  />
                </div>
                <div className="question-actions">
                  <button className="btn btn-primary" onClick={sendAnswer} disabled={loading.next || !answer.trim()}>
                    {loading.next ? 'Sending…' : 'Send Answer'}
                  </button>
                  <button className="btn btn-secondary" onClick={restartInterview} disabled={loading.next || loading.report}>
                    Start Over
                  </button>
                  <button className="btn btn-secondary" onClick={generateReport} disabled={loading.report} title="Finish now and generate a report">
                    {loading.report ? 'Generating…' : 'Generate Report'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {done && (
            <div className="card interview-question-section">
              <h3 className="card-title">Interview Complete</h3>
              <p className="muted">Generate a final report based on your answers.</p>
              <button className="btn btn-success" onClick={generateReport} disabled={loading.report}>
                {loading.report ? 'Generating…' : 'Generate Report'}
              </button>
            </div>
          )}
        </div>

        <div className="interview-sidebar">
          {turns.length > 0 && (
            <div className="card interview-transcript-section">
              <h3 className="card-title">Transcript</h3>
              <div className="transcript">
                {turns.map((t, idx) => (
                  <div key={idx} className="transcript-item">
                    <div className="transcript-question">Q{idx + 1}: {t.q}</div>
                    <div className="transcript-answer">A{idx + 1}: {t.a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {report && (
          <div className="card report-container interview-report-section">
            <h3 className="card-title">AI Health Report</h3>
            <pre className="report-content">{report}</pre>
          </div>
        )}
      </div>

      <div className="back-actions" style={{ marginTop: 16 }}>
        <button className="btn-secondary" onClick={() => navigate('/patient')}>Back</button>
      </div>
    </main>
  );
}

export default AIInterviewPage;

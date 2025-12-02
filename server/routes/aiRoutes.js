const express = require('express');
const { randomUUID } = require('crypto');
const { chatJSON } = require('../utils/openaiClient');
const { saveConversation, saveReport } = require('../utils/supabaseClient');

const router = express.Router();

// In-memory session store: sessionId -> { history: [], turns: 0, createdAt, meta }
const sessions = new Map();

function buildSystemPrompt(language = 'en') {
  const base = (
    'You are a clinical intake assistant. Goal: ask 10–15 focused, medically relevant questions, one at a time, to gather sufficient info for a doctor.\n' +
    '- Always return ONLY valid JSON with keys: {"question":"...","done":false}.\n' +
    '- If you have enough info, return {"question":"","done":true}.\n' +
    '- Keep each question short, clear, and clinically meaningful.\n' +
    '- Avoid greetings or explanations. No markdown, no code fences.'
  );
  const languageInstruction = language === 'bn'
    ? '\n- All patient-facing text (questions, clarifications) must be written in Bangla (বাংলা).'
    : '\n- Use English for all patient-facing text.';
  return base + languageInstruction;
}

function parseJSON(str, fallback = null) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// Generate a strict-JSON questionnaire via OpenAI (fallback to HF handled by caller/UI)
router.post('/ai/questionnaire', async (req, res) => {
  try {
    const { symptom } = req.body || {};
    const prompt = `You are an assistant that returns strict JSON. Return ONLY valid JSON. Generate exactly 3 medical yes/no questions tailored for a patient with ${symptom || 'fever'} symptoms. Output MUST be a single JSON object with this exact structure and keys:\n{"questions":[{"id":1,"text":"<string>","type":"yes_no"},{"id":2,"text":"<string>","type":"yes_no"},{"id":3,"text":"<string>","type":"yes_no"}]}
No markdown, no code fences, no extra text. Use double quotes.`;

    const content = await chatJSON([
      { role: 'system', content: 'Return ONLY valid JSON. No prose.' },
      { role: 'user', content: prompt }
    ], 0.2);

    return res.json({ ok: true, text: content });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post('/chat/start', async (req, res) => {
  try {
    const { symptom, vitals, documents, userId, language } = req.body || {};
    const normalizedLanguage = language === 'bn' ? 'bn' : 'en';
    const sessionId = randomUUID();
    const history = [
      { role: 'system', content: buildSystemPrompt(normalizedLanguage) },
      { role: 'user', content: JSON.stringify({ symptom: symptom || '', vitals: vitals || {}, documents: documents || [] }) }
    ];

    const content = await chatJSON(history, 0.7);
    const data = parseJSON(content, {});
    const question = typeof data?.question === 'string' && data.question.trim() ? data.question.trim() : 'Please describe your main symptom in one sentence.';
    const done = Boolean(data?.done);

    // Record the first assistant question in history so subsequent turns have full context
    if (question && !done) {
      history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
    } else if (done) {
      // Edge case: model signaled done immediately
      history.push({ role: 'assistant', content: JSON.stringify({ question: '', done: true }) });
    }

    sessions.set(sessionId, { history, turns: 1, createdAt: Date.now(), meta: { userId, vitals: vitals || {}, documents: documents || [], language: normalizedLanguage } });
    await saveConversation(sessionId, userId, history, { phase: 'start' });

    return res.json({ sessionId, question, done: Boolean(done) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post('/chat/next', async (req, res) => {
  try {
    const { sessionId, answer, language } = req.body || {};
    const sess = sessions.get(sessionId);
    if (!sess) return res.status(400).json({ error: 'invalid sessionId' });

    if (language && (language === 'bn' || language === 'en') && sess.meta) {
      sess.meta.language = language;
    }

    // Append last answer
    sess.history.push({ role: 'user', content: String(answer || '').trim() });
    sess.turns = (sess.turns || 0) + 1;
    const limitReached = (sess.turns >= 15);

    const content = await chatJSON(sess.history, 0.7);
    const data = parseJSON(content, {});
    const question = typeof data?.question === 'string' ? data.question.trim() : '';
    const doneSignal = Boolean(data?.done);
    const done = doneSignal || limitReached || !question;

    // If not done, add assistant question to history
    if (!done) {
      sess.history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
    }

    await saveConversation(sessionId, sess.meta?.userId || null, sess.history, { phase: done ? 'end' : 'ongoing' });

    return res.json({ sessionId, question: done ? '' : question, done });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post('/chat/report', async (req, res) => {
  try {
    const { sessionId, language } = req.body || {};
    const sess = sessions.get(sessionId);
    if (!sess) return res.status(400).json({ error: 'invalid sessionId' });

    if (language && (language === 'bn' || language === 'en') && sess.meta) {
      sess.meta.language = language;
    }

    const reportLanguage = sess.meta?.language === 'bn' ? 'Bangla (বাংলা)' : 'English';
    const system = `Return ONLY valid JSON with a single key: {"report":"<markdown>"}. Produce a concise, structured clinical report with headings exactly: Chief Complaint, History of Present Illness, Vitals, Probable Diagnosis, Recommendations. Write the patient-facing text in ${reportLanguage}.`;
    const history = [
      { role: 'system', content: system },
      ...sess.history,
      { role: 'user', content: JSON.stringify({ instruction: 'Generate final report now', vitals: sess.meta?.vitals || {}, documents: sess.meta?.documents || [] }) }
    ];

    const content = await chatJSON(history, 0.4);
    const data = parseJSON(content, {});
    const report = typeof data?.report === 'string' && data.report.trim() ? data.report.trim() : 'Chief Complaint:\n- N/A\n\nHistory of Present Illness:\n- N/A\n\nVitals:\n- N/A\n\nProbable Diagnosis:\n- N/A\n\nRecommendations:\n- N/A';

    // Attempt to persist
    await saveConversation(sessionId, sess.meta?.userId || null, sess.history, { phase: 'report' });
    await saveReport(sess.meta?.userId || null, null, report);

    return res.json({ report });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

module.exports = router;
// Self-test endpoint to verify AI connectivity
router.get('/ai/self-test', async (req, res) => {
  try {
    // Prefer OpenAI if configured; else try HF proxy upstream via server index (same process env)
    try {
      const content = await chatJSON([
        { role: 'system', content: 'Return ONLY valid JSON: {"ok":true}' },
        { role: 'user', content: 'Ping' }
      ], 0.1);
      const ok = /true/i.test(String(content));
      return res.json({ provider: 'openai', ok, raw: content });
    } catch (e) {
      // Fall back to HF if available via server-side fetch
      const HF_ENDPOINT_URL = (process.env.HF_ENDPOINT_URL || process.env.REACT_APP_HF_ENDPOINT_URL || '').trim();
      const HF_API_TOKEN = (process.env.HF_API_TOKEN || process.env.REACT_APP_HF_API_TOKEN || '').trim();
      if (!HF_ENDPOINT_URL || !HF_API_TOKEN) throw e;
      const resp = await fetch(HF_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HF_API_TOKEN}` },
        body: JSON.stringify({ inputs: 'Return ONLY valid JSON: {"ok":true}', parameters: { max_new_tokens: 32, temperature: 0.1, return_full_text: false }, options: { wait_for_model: true } })
      });
      const text = await resp.text();
      if (!resp.ok) return res.status(resp.status).send(text);
      return res.json({ provider: 'huggingface', ok: true, raw: text });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


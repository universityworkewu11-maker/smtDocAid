// In-memory session store for interview sessions
const sessions = new Map();

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function buildInterviewSystemPrompt() {
  return (
    'You are a clinical intake assistant. Ask one question at a time to collect relevant information for a doctor.\n' +
    '- Always return ONLY valid JSON with keys: {"question":"<string>","done":false}.\n' +
    '- If you have enough information, return {"question":"","done":true}.\n' +
    '- Keep questions short, clear, and medically relevant.\n' +
    '- No greetings or explanations. No markdown. No code fences.'
  );
}

async function openaiChat(messages, { temperature = 0.3, max_tokens = 800 } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY on server');
  const models = [process.env.OPENAI_MODEL || 'gpt-4o-2024-11-20', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].filter(Boolean);
  let lastErr = null;
  for (const m of models) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: m, messages, temperature, max_tokens, stream: false })
      });
      const txt = await response.text();
      if (!response.ok) {
        if (response.status === 401 || /api key/i.test(txt)) throw new Error('Invalid OpenAI API key');
        lastErr = new Error(`HTTP ${response.status} ${txt}`);
        continue;
      }
      const data = JSON.parse(txt);
      return (data?.choices?.[0]?.message?.content || '').trim();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('OpenAI request failed');
}

function parseJSON(s, fallback = null) {
  try { return JSON.parse(String(s)); } catch { return fallback; }
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { context } = req.body || {};
    const sessionId = uuid();
    const history = [
      { role: 'system', content: buildInterviewSystemPrompt() },
      { role: 'user', content: JSON.stringify({ context: context || {}, instruction: 'Begin interview now.' }) }
    ];
    const content = await openaiChat(history, { temperature: 0.4, max_tokens: 200 });
    const data = parseJSON(content, {});
    const question = typeof data?.question === 'string' && data.question.trim() ? data.question.trim() : 'What brings you in today?';
    const done = Boolean(data?.done);
    if (!done) {
      history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
    } else {
      history.push({ role: 'assistant', content: JSON.stringify({ question: '', done: true }) });
    }
    sessions.set(sessionId, { history, turns: 1, createdAt: Date.now() });
    return res.json({ ok: true, sessionId, question, done });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
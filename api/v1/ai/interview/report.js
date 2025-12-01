// Shared session store (in production, use Redis or database)
const sessions = new Map();

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

import { handleCors } from '../../corsHelper.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const SERVER_BASE = (process.env.SERVER_BASE || process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
    if (!SERVER_BASE) return res.status(500).json({ ok: false, error: 'SERVER_BASE not configured on serverless proxy' });
    const upstream = `${SERVER_BASE}/api/v1/ai/interview/report`;
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers['authorization'] || '' },
      body: JSON.stringify(req.body || {})
    });
    const text = await r.text();
    res.status(r.status);
    try { return res.send(text); } catch { return res.end(text); }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
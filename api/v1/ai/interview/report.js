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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { sessionId } = req.body || {};
    const sess = sessions.get(sessionId);
    if (!sess) return res.status(400).json({ ok: false, error: 'invalid sessionId' });
    const system = 'Return ONLY valid JSON with a single key: {"report":"<markdown>"}. At the very top of the markdown (before any headings), include four lines in this exact format using available context (or N/A if unknown):\nName: <name>\nAge: <age>\nGender: <gender>\nContact: <phone>. After those lines, produce a concise, structured clinical report with headings exactly: Chief Complaint, History of Present Illness, Vitals, Probable Diagnosis, Recommendations.';
    const history = [
      { role: 'system', content: system },
      ...sess.history,
      { role: 'user', content: 'Generate the final report now as JSON.' }
    ];
    const content = await openaiChat(history, { temperature: 0.2, max_tokens: 800 });
    const data = parseJSON(content, {});
    const report = typeof data?.report === 'string' && data.report.trim() ? data.report.trim() : 'Chief Complaint:\n- N/A\n\nHistory of Present Illness:\n- N/A\n\nVitals:\n- N/A\n\nProbable Diagnosis:\n- N/A\n\nRecommendations:\n- N/A';
    return res.json({ ok: true, report });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
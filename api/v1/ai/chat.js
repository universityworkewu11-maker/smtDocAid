import { handleCors } from '../corsHelper.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ ok: false, error: 'Missing OPENAI_API_KEY on server' });
    }

    const { messages = [], model, temperature = 0.3, max_tokens = 1200 } = req.body || {};
    const models = [model || process.env.OPENAI_MODEL || 'gpt-4o-2024-11-20', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].filter(Boolean);
    let lastErr = null;

    for (const m of models) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({ model: m, messages, temperature, max_tokens, stream: false })
        });

        const txt = await response.text();
        if (!response.ok) {
          // If wrong model, try next; if invalid key, return now with masked message
          if (response.status === 401 || /api key/i.test(txt)) {
            return res.status(401).json({ ok: false, error: 'Invalid OpenAI API key' });
          }
          lastErr = new Error(`HTTP ${response.status} ${txt}`);
          continue;
        }

        const data = JSON.parse(txt);
        const out = data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.text?.trim() || '';
        return res.json({ ok: true, text: out, raw: data });
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('OpenAI request failed');
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
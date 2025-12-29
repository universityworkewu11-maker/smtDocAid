// CORS helper for Vercel serverless functions
function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://smt-doc-aid.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // Indicate that the request was handled
  }
  return false; // Continue with normal processing
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const SERVER_BASE = (process.env.SERVER_BASE || process.env.REACT_APP_SERVER_BASE || '').replace(/\/$/, '');
    if (!SERVER_BASE) return res.status(500).json({ ok: false, error: 'SERVER_BASE not configured on serverless proxy' });
    const upstream = `${SERVER_BASE}/api/v1/ai/interview/start`;
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
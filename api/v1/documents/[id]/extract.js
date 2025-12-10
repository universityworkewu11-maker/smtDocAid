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
    // Expect Bearer token from client (Supabase access token)
    const auth = req.headers.authorization || '';
    const token = auth.split(' ')[1] || null;
    // Diagnostic logging (do not log secret token itself)
    console.log(`[extract-doc] doc=${req.query.id} authHeader=${auth ? 'present' : 'missing'} tokenPresent=${!!token}`);
    if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

    // Use the service-role client to validate the token and inspect the document
    const { createClient } = await import('@supabase/supabase-js');
    // Accept frontend-style env names as a fallback in case Vercel has REACT_APP_* variables set
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server missing Supabase configuration' });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Validate token to get user identity
    const authRes = await admin.auth.getUser(token);
    const user = authRes?.data?.user;
    console.log(`[extract-doc] auth.getUser => user=${user ? user.id : 'none'}`);
    if (!user) return res.status(401).json({ error: 'Invalid session token' });

    // Verify doc belongs to user
    const docId = req.query.id;
    const { data: docRow, error: docErr } = await admin.from('documents').select('id, user_id').eq('id', docId).single();
    if (docErr || !docRow) {
      console.log(`[extract-doc] doc lookup failed doc=${docId} err=${docErr?.message || 'none'}`);
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docRow.user_id !== user.id) {
      console.log(`[extract-doc] forbidden: doc.user=${docRow.user_id} caller=${user.id}`);
      return res.status(403).json({ error: 'Forbidden' });
    }

    console.log(`[extract-doc] starting extraction for doc=${docId} user=${user.id}`);
    // Run extraction for this document
    const { runExtractionForDocument } = await import('../../../documentExtractor.js');
    const result = await runExtractionForDocument(docId);
    console.log(`[extract-doc] finished extraction for doc=${docId} result=${JSON.stringify(result).slice(0,200)}`);
    return res.json({ ok: true, result });
  } catch (err) {
    // Log full error object (including stack) for debugging in Vercel logs
    console.error('extract-document error', err);
    const msg = err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
}
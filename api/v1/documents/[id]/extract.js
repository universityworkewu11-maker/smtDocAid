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

// Document extraction helpers
const fetch = globalThis.fetch;

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  DOCUMENT_EXTRACTION_BATCH = '3'
} = process.env;

const MAX_TEXT_LENGTH = 12000;
const SUMMARY_MODEL = process.env.DOCUMENT_SUMMARY_MODEL || 'gpt-4o-mini';

async function makeClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function downloadDocument(supabase, doc) {
  const bucket = doc.storage_bucket || process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
  const { data, error } = await supabase.storage.from(bucket).download(doc.storage_path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractPdf(buffer) {
  const pdfParse = (await import('pdf-parse')).default;
  const parsed = await pdfParse(buffer);
  return parsed?.text || '';
}

async function extractPlain(buffer) {
  return buffer.toString('utf8');
}

async function extractImage(buffer, mimeType) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required for image OCR');
  const base64 = buffer.toString('base64');
  const payload = {
    model: 'gpt-4o', // Use gpt-4o for better OCR accuracy
    messages: [
      { role: 'system', content: 'Perform OCR on this image and extract all visible text, including handwritten text. Return the extracted text as plain text only, preserving the original formatting as much as possible.' },
      { role: 'user', content: [{ type: 'input_text', text: 'Extract all text from the image verbatim.' }, { type: 'input_image', image_url: `data:${mimeType};base64,${base64}` }] }
    ]
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`OCR request failed: ${txt}`);
  const data = JSON.parse(txt);
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function summarizeText(content, title) {
  if (!OPENAI_API_KEY) return '';
  if (!content) return '';
  const prompt = `Document: ${title || 'Clinical document'}\n\nContent:\n${content.slice(0, 6000)}\n\nSummarize the key clinical findings (labs, diagnoses, medications, follow-up). Return 3-5 short bullet points.`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: SUMMARY_MODEL, messages: [{ role: 'system', content: 'You summarize clinical documents succinctly.' }, { role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 })
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Summary failed: ${txt}`);
  const data = JSON.parse(txt);
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function processDocument(supabase, doc) {
  try {
    await supabase.from('documents').update({ extraction_status: 'processing', extraction_error: null }).eq('id', doc.id);
    const buffer = await downloadDocument(supabase, doc);
    let text = '';
    if ((doc.mime_type || '').includes('pdf')) text = await extractPdf(buffer);
    else if ((doc.mime_type || '').startsWith('image/')) text = await extractImage(buffer, doc.mime_type);
    else if ((doc.mime_type || '').includes('text') || (doc.mime_type || '').includes('json')) text = await extractPlain(buffer);
    else text = await extractPlain(buffer);

    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    const summary = await summarizeText(normalized, doc.original_name);

    await supabase.from('documents').update({ extracted_text: normalized || null, extraction_summary: summary || null, extraction_status: 'complete', extraction_error: null, last_extracted_at: new Date().toISOString() }).eq('id', doc.id);
    return { id: doc.id, status: 'complete' };
  } catch (err) {
    await supabase.from('documents').update({ extraction_status: 'failed', extraction_error: err.message }).eq('id', doc.id);
    return { id: doc.id, status: 'failed', error: err.message };
  }
}

async function runExtractionForDocument(docId) {
  const supabase = await makeClient();
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, user_id, storage_bucket, storage_path, mime_type, original_name, extraction_status, uploaded_at')
    .eq('id', docId)
    .single();
  if (error || !doc) throw new Error('Document not found');
  return await processDocument(supabase, doc);
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
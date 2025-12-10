const pdfParse = require('pdf-parse');
const fetch = globalThis.fetch;

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  DOCUMENT_EXTRACTION_BATCH = '3'
} = process.env;

const BATCH_SIZE = Number.parseInt(DOCUMENT_EXTRACTION_BATCH, 10) || 3;
const MAX_TEXT_LENGTH = 12000;
const SUMMARY_MODEL = process.env.DOCUMENT_SUMMARY_MODEL || 'gpt-4o-mini';

async function makeClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function fetchPendingDocuments(supabase) {
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, storage_bucket, storage_path, mime_type, original_name, extraction_status, uploaded_at')
    .or('extraction_status.is.null,extraction_status.eq.pending,extraction_status.eq.failed')
    .order('uploaded_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  return data || [];
}

async function downloadDocument(supabase, doc) {
  const bucket = doc.storage_bucket || process.env.REACT_APP_SUPABASE_BUCKET || 'uploads';
  const { data, error } = await supabase.storage.from(bucket).download(doc.storage_path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractPdf(buffer) {
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

async function runExtractionBatch() {
  const supabase = await makeClient();
  const pending = await fetchPendingDocuments(supabase);
  if (!pending.length) return { processed: [], message: 'No pending documents' };
  const results = [];
  for (const doc of pending) {
    // sequential processing to avoid heavy parallel API usage
    // eslint-disable-next-line no-await-in-loop
    const res = await processDocument(supabase, doc);
    results.push(res);
  }
  return { processed: results };
}

module.exports = { runExtractionBatch, runExtractionForDocument };
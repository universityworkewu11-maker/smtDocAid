import fetch from 'cross-fetch';
import { createClient } from '@supabase/supabase-js';

// Polyfill DOMMatrix for environments (Node runtimes / serverless) that
// don't provide Web DOM geometry APIs. pdf.js (used by `pdf-parse`)
// may reference `DOMMatrix` at import time, so we provide a minimal shim
// here and use a dynamic import for `pdf-parse` so the shim is in place
// before pdf.js initializes.
if (typeof global.DOMMatrix === 'undefined') {
  // Minimal DOMMatrix shim that satisfies pdf.js presence checks.
  // Full math operations are rarely required for text extraction; if
  // pdf.js needs actual transform math, consider using a fuller polyfill
  // or upgrading to a Node runtime with Web APIs (Node 20+).
  global.DOMMatrix = class DOMMatrix {
    constructor() {
      // no-op; we only need the constructor to exist for pdf.js
    }
    toFloat32Array() {
      return new Float32Array(16);
    }
  };
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  DOCUMENT_EXTRACTION_BATCH = '3'
} = process.env;

const BATCH_SIZE = Number.parseInt(DOCUMENT_EXTRACTION_BATCH, 10) || 3;
const MAX_TEXT_LENGTH = 12000;
const SUMMARY_MODEL = process.env.DOCUMENT_SUMMARY_MODEL || 'gpt-4o-mini';

function makeClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// Debug logging for environment variables (only in development)
if (process.env.NODE_ENV !== 'production') {
  console.log('[documentExtractor] Environment check:', {
    hasSupabaseUrl: Boolean(SUPABASE_URL),
    hasSupabaseKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    hasOpenAIKey: Boolean(OPENAI_API_KEY),
    batchSize: BATCH_SIZE,
    summaryModel: SUMMARY_MODEL
  });
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
  // Ensure pdf.js doesn't require a browser workerSrc. Some builds of
  // pdf.js check for a worker path and throw "No PDFJS.workerSrc specified".
  // Provide minimal global options and disable worker usage via env flag.
  try {
    process.env.PDFJS_DISABLE_WORKER = process.env.PDFJS_DISABLE_WORKER || 'true';
  } catch (_) {}
  if (typeof globalThis.pdfjsLib === 'undefined') {
    // Provide a minimal shape that pdf-parse/pdf.js may check at import-time.
    try {
      globalThis.pdfjsLib = globalThis.pdfjsLib || {};
      globalThis.pdfjsLib.GlobalWorkerOptions = globalThis.pdfjsLib.GlobalWorkerOptions || {};
      // Provide a non-empty workerSrc and explicitly disable worker usage so
      // pdf.js won't attempt to spawn a WebWorker in a Node environment.
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc || 'about:blank';
      globalThis.pdfjsLib.disableWorker = true;
    } catch (_) {}
  }
  if (typeof globalThis.PDFJS === 'undefined') {
    try {
      globalThis.PDFJS = globalThis.PDFJS || {};
      globalThis.PDFJS.GlobalWorkerOptions = globalThis.PDFJS.GlobalWorkerOptions || {};
      globalThis.PDFJS.GlobalWorkerOptions.workerSrc = globalThis.PDFJS.GlobalWorkerOptions.workerSrc || 'about:blank';
      globalThis.PDFJS.disableWorker = true;
    } catch (_) {}
  }
  // Diagnostic: confirm shim presence in logs
  try { console.log('[documentExtractor] pdf.js shim applied: workerSrc=', globalThis.pdfjsLib?.GlobalWorkerOptions?.workerSrc, 'disableWorker=', globalThis.pdfjsLib?.disableWorker); } catch (_) {}

  // Import pdf-parse dynamically so the DOMMatrix shim above exists
  // before pdf.js initializes.
  const { default: pdfParse } = await import('pdf-parse');
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
    console.log(`[documentExtractor] Processing document ${doc.id}: ${doc.original_name} (${doc.mime_type})`);
    await supabase.from('documents').update({ extraction_status: 'processing', extraction_error: null }).eq('id', doc.id);
    const buffer = await downloadDocument(supabase, doc);
    console.log(`[documentExtractor] Downloaded ${buffer.length} bytes for ${doc.id}`);

    let text = '';
    if ((doc.mime_type || '').includes('pdf')) {
      console.log(`[documentExtractor] Extracting PDF for ${doc.id}`);
      text = await extractPdf(buffer);
    } else if ((doc.mime_type || '').startsWith('image/')) {
      console.log(`[documentExtractor] Extracting image (OCR) for ${doc.id}`);
      text = await extractImage(buffer, doc.mime_type);
    } else if ((doc.mime_type || '').includes('text') || (doc.mime_type || '').includes('json')) {
      console.log(`[documentExtractor] Extracting plain text for ${doc.id}`);
      text = await extractPlain(buffer);
    } else {
      console.log(`[documentExtractor] Extracting as plain text (fallback) for ${doc.id}`);
      text = await extractPlain(buffer);
    }

    console.log(`[documentExtractor] Extracted ${text.length} characters for ${doc.id}`);
    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    console.log(`[documentExtractor] Normalized to ${normalized.length} characters for ${doc.id}`);

    const summary = await summarizeText(normalized, doc.original_name);
    console.log(`[documentExtractor] Generated summary for ${doc.id}`);

    await supabase.from('documents').update({
      extracted_text: normalized || null,
      extraction_summary: summary || null,
      extraction_status: 'complete',
      extraction_error: null,
      last_extracted_at: new Date().toISOString()
    }).eq('id', doc.id);

    console.log(`[documentExtractor] Completed processing for ${doc.id}`);
    return { id: doc.id, status: 'complete' };
  } catch (err) {
    console.error(`[documentExtractor] Error processing ${doc.id}:`, err.message);
    await supabase.from('documents').update({ extraction_status: 'failed', extraction_error: err.message }).eq('id', doc.id);
    return { id: doc.id, status: 'failed', error: err.message };
  }
}

export async function runExtractionForDocument(docId) {
  const supabase = makeClient();
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, user_id, storage_bucket, storage_path, mime_type, original_name, extraction_status, uploaded_at')
    .eq('id', docId)
    .single();
  if (error || !doc) throw new Error('Document not found');
  return await processDocument(supabase, doc);
}

export async function runExtractionBatch() {
  console.log('[documentExtractor] Starting extraction batch');
  const supabase = makeClient();
  const pending = await fetchPendingDocuments(supabase);
  console.log(`[documentExtractor] Found ${pending.length} pending documents`);
  if (!pending.length) return { processed: [], message: 'No pending documents' };
  const results = [];
  for (const doc of pending) {
    // sequential processing to avoid heavy parallel API usage
    // eslint-disable-next-line no-await-in-loop
    console.log(`[documentExtractor] Processing document ${doc.id}`);
    const res = await processDocument(supabase, doc);
    results.push(res);
  }
  console.log(`[documentExtractor] Batch completed, processed ${results.length} documents`);
  return { processed: results };
}

export default { runExtractionBatch, runExtractionForDocument };
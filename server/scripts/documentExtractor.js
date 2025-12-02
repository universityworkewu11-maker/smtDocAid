import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fetch from 'cross-fetch';
import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  DOCUMENT_EXTRACTION_BATCH = '3'
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.error('[doc-extractor] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const BATCH_SIZE = Number.parseInt(DOCUMENT_EXTRACTION_BATCH, 10) || 3;
const MAX_TEXT_LENGTH = 12000;
const SUMMARY_MODEL = process.env.DOCUMENT_SUMMARY_MODEL || 'gpt-4o-mini';

async function fetchPendingDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, storage_bucket, storage_path, mime_type, original_name, extraction_status')
    .or('extraction_status.is.null,extraction_status.eq.pending,extraction_status.eq.failed')
    .order('uploaded_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  return data || [];
}

async function downloadDocument(doc) {
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
    model: SUMMARY_MODEL,
    messages: [
      {
        role: 'system',
        content: 'Extract all medically relevant text from this clinical document image. Return plain text only.'
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Extract text verbatim.' },
          {
            type: 'input_image',
            image_url: `data:${mimeType};base64,${base64}`
          }
        ]
      }
    ]
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: 'You summarize clinical documents succinctly.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 400
    })
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Summary failed: ${txt}`);
  const data = JSON.parse(txt);
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function processDocument(doc) {
  try {
    await supabase
      .from('documents')
      .update({ extraction_status: 'processing', extraction_error: null })
      .eq('id', doc.id);

    const buffer = await downloadDocument(doc);
    let text = '';
    if ((doc.mime_type || '').includes('pdf')) {
      text = await extractPdf(buffer);
    } else if ((doc.mime_type || '').startsWith('image/')) {
      text = await extractImage(buffer, doc.mime_type);
    } else if ((doc.mime_type || '').includes('text') || (doc.mime_type || '').includes('json')) {
      text = await extractPlain(buffer);
    } else {
      text = await extractPlain(buffer);
    }

    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    const summary = await summarizeText(normalized, doc.original_name);

    await supabase
      .from('documents')
      .update({
        extracted_text: normalized || null,
        extraction_summary: summary || null,
        extraction_status: 'complete',
        extraction_error: null,
        last_extracted_at: new Date().toISOString()
      })
      .eq('id', doc.id);

    // eslint-disable-next-line no-console
    console.log(`[doc-extractor] Processed ${doc.id}`);
  } catch (err) {
    await supabase
      .from('documents')
      .update({ extraction_status: 'failed', extraction_error: err.message })
      .eq('id', doc.id);
    // eslint-disable-next-line no-console
    console.error(`[doc-extractor] Failed ${doc.id}:`, err.message);
  }
}

(async () => {
  const pending = await fetchPendingDocuments();
  if (!pending.length) {
    // eslint-disable-next-line no-console
    console.log('[doc-extractor] No pending documents.');
    return;
  }
  for (const doc of pending) {
    // eslint-disable-next-line no-await-in-loop
    await processDocument(doc);
  }
})();

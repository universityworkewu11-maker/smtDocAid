// Polyfill DOMMatrix for pdf-parse in Node.js environment
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;

      if (init) {
        if (typeof init === 'string') {
          // Parse matrix string like "matrix(a,b,c,d,e,f)"
          const match = init.match(/matrix\(([^)]+)\)/);
          if (match) {
            const values = match[1].split(',').map(v => parseFloat(v.trim()));
            this.m11 = values[0] || 1;
            this.m12 = values[1] || 0;
            this.m21 = values[2] || 0;
            this.m22 = values[3] || 1;
            this.m41 = values[4] || 0;
            this.m42 = values[5] || 0;
          }
        } else if (Array.isArray(init)) {
          [this.m11, this.m12, this.m21, this.m22, this.m41, this.m42] = init;
        }
      }
    }

    get a() { return this.m11; }
    get b() { return this.m12; }
    get c() { return this.m21; }
    get d() { return this.m22; }
    get e() { return this.m41; }
    get f() { return this.m42; }

    translate(x, y) {
      this.m41 += x;
      this.m42 += y;
      return this;
    }

    scale(x, y = x) {
      this.m11 *= x;
      this.m22 *= y;
      return this;
    }

    rotate(angle) {
      const cos = Math.cos(angle * Math.PI / 180);
      const sin = Math.sin(angle * Math.PI / 180);
      const { m11, m12, m21, m22 } = this;
      this.m11 = m11 * cos + m21 * sin;
      this.m12 = m12 * cos + m22 * sin;
      this.m21 = -m11 * sin + m21 * cos;
      this.m22 = -m12 * sin + m22 * cos;
      return this;
    }

    toString() {
      return `matrix(${this.m11}, ${this.m12}, ${this.m21}, ${this.m22}, ${this.m41}, ${this.m42})`;
    }
  };
  global.DOMMatrix = globalThis.DOMMatrix;
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {};
  }
  globalThis.window.DOMMatrix = globalThis.DOMMatrix;
}

import dotenv from 'dotenv';
dotenv.config();
// Minimal Express server for OpenAI proxy
import express from 'express';
import cors from 'cors';
import fetch from 'cross-fetch';
import pkg from './lib/documentExtractor.js';
const { runExtractionBatch } = pkg;

// Use global fetch if available; otherwise fall back to cross-fetch (avoid top-level await for Node compatibility)
const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : fetch;

const app = express();

// CORS helper function (supports local dev + production)
function setCorsHeaders(req, res) {
	const defaults = [
		'https://smt-doc-aid.vercel.app',
		'http://localhost:3000',
		'http://127.0.0.1:3000',
		'http://localhost:5173',
		'http://127.0.0.1:5173'
	];
	const extra = (process.env.ALLOWED_ORIGINS || process.env.REACT_APP_ALLOWED_ORIGINS || '')
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
	const allowed = new Set([...defaults, ...extra]);
	const origin = req.headers?.origin;
	const allowOrigin = origin && allowed.has(origin) ? origin : 'https://smt-doc-aid.vercel.app';
	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Origin', allowOrigin);
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// Handle all OPTIONS requests globally
app.options('*', (req, res) => {
	setCorsHeaders(req, res);
  res.status(200).end();
});
// Basic request logging to debug 404/method/path issues
app.use((req, _res, next) => {
	try {
		console.log(`[req] ${req.method} ${req.url}`);
	} catch (_) {}
	next();
});
app.use(express.json({ limit: '1mb' }));

// Environment validation
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('[server] Missing required environment variables:', missingVars);
  console.error('[server] Please set these environment variables before starting the server');
  process.exit(1);
}

const PORT = process.env.PORT || 5001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY || '';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-2024-11-20';
const DEFAULT_ASSISTANT_ID = process.env.ASSISTANT_ID || '';

// Log environment status (without exposing secrets)
console.log('[server] Environment check:', {
  hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
  hasSupabaseKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  hasOpenAIKey: Boolean(OPENAI_API_KEY),
  port: PORT,
  model: DEFAULT_MODEL
});

// Health under both /api/health and /health for compatibility
app.get('/health', (req, res) => {
	setCorsHeaders(req, res);
	res.json({
		ok: true,
		provider: 'openai',
		hasKey: Boolean(OPENAI_API_KEY),
		hasSupabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
		environment: process.env.NODE_ENV || 'development'
	});
});
app.get('/api/health', (req, res) => {
	setCorsHeaders(req, res);
	res.json({
		ok: true,
		provider: 'openai',
		hasKey: Boolean(OPENAI_API_KEY),
		hasSupabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
		environment: process.env.NODE_ENV || 'development'
	});
});

// Internal: trigger one extraction batch (protected by INTERNAL_SECRET)
app.post('/internal/extract-documents', async (req, res) => {
	setCorsHeaders(req, res);
	const secret = process.env.INTERNAL_SECRET;
	const provided = req.get('x-internal-secret') || req.body?.secret;
	if (!secret || provided !== secret) return res.status(401).json({ error: 'unauthorized' });
	try {
		const result = await runExtractionBatch();
		return res.json({ ok: true, result });
	} catch (err) {
		return res.status(500).json({ ok: false, error: err?.message || String(err) });
	}
});

// Extract specific document by ID
app.post('/api/v1/documents/:id/extract', async (req, res) => {
	setCorsHeaders(req, res);
	try {
		const { id } = req.params;
		if (!id) return res.status(400).json({ ok: false, error: 'Document ID required' });

		// Check if required environment variables are present
		const envCheck = {
			tokenPresent: Boolean(req.headers.authorization || req.headers['x-api-key']),
			backendEnv: process.env.NODE_ENV || 'undefined',
			hasSupabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
			hasOpenAI: Boolean(OPENAI_API_KEY)
		};

		console.log(`[extract-document] Starting extraction for ${id}, env check:`, envCheck);

		const { runExtractionForDocument } = pkg;
		const result = await runExtractionForDocument(id);
		console.log(`[extract-document] Completed extraction for ${id}:`, result);
		return res.json({ ok: true, result, envCheck });
	} catch (err) {
		console.error('[extract-document]', err);
		return res.status(500).json({
			ok: false,
			error: err?.message || String(err),
			envCheck: {
				tokenPresent: Boolean(req.headers.authorization || req.headers['x-api-key']),
				backendEnv: process.env.NODE_ENV || 'undefined',
				hasSupabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
				hasOpenAI: Boolean(OPENAI_API_KEY)
			}
		});
	}
});

// Chat proxy: POST /api/v1/ai/chat { messages: [...], model?: string, temperature?: number, max_tokens?: number }
app.post('/api/v1/ai/chat', async (req, res) => {
	setCorsHeaders(req, res);
	try {
		if (!OPENAI_API_KEY) {
			return res.status(400).json({ ok: false, error: 'Missing OPENAI_API_KEY on server' });
		}
		const { messages = [], model, temperature = 0.3, max_tokens = 1200 } = req.body || {};
		const models = [model || DEFAULT_MODEL, 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].filter(Boolean);
		let lastErr = null;

		for (const m of models) {
			try {
				const r = await fetchFn('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${OPENAI_API_KEY}`
					},
					body: JSON.stringify({ model: m, messages, temperature, max_tokens, stream: false })
				});
				const txt = await r.text();
				if (!r.ok) {
					// If wrong model, try next; if invalid key, return now with masked message
					if (r.status === 401 || /api key/i.test(txt)) {
						return res.status(401).json({ ok: false, error: 'Invalid OpenAI API key' });
					}
					lastErr = new Error(`HTTP ${r.status} ${txt}`);
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
});

// Assistants API proxy: POST /api/v1/ai/assistant { assistantId, input }
// Creates a thread, adds a user message, runs the assistant, polls until complete, returns final text
app.post('/api/v1/ai/assistant', async (req, res) => {
	try {
		if (!OPENAI_API_KEY) {
			return res.status(400).json({ ok: false, error: 'Missing OPENAI_API_KEY on server' });
		}
		const { assistantId, input, instructions } = req.body || {};
		const asst = assistantId || DEFAULT_ASSISTANT_ID;
		if (!asst || !input) {
			return res.status(400).json({ ok: false, error: 'assistantId and input are required' });
		}

		const headers = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${OPENAI_API_KEY}`
		};

		// 1) create thread
		const tRes = await fetchFn('https://api.openai.com/v1/threads', { method: 'POST', headers, body: JSON.stringify({}) });
		if (!tRes.ok) {
			const t = await tRes.text();
			return res.status(tRes.status).json({ ok: false, error: `Thread create failed: ${t}` });
		}
		const thread = await tRes.json();

		// 2) add user message
		const mRes = await fetchFn(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
			method: 'POST', headers, body: JSON.stringify({ role: 'user', content: input })
		});
		if (!mRes.ok) {
			const t = await mRes.text();
			return res.status(mRes.status).json({ ok: false, error: `Message create failed: ${t}` });
		}

		// 3) run assistant
			const rRes = await fetchFn(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
				method: 'POST', headers, body: JSON.stringify({ assistant_id: asst, instructions })
		});
		if (!rRes.ok) {
			const t = await rRes.text();
			return res.status(rRes.status).json({ ok: false, error: `Run start failed: ${t}` });
		}
		const run = await rRes.json();

		// 4) poll until completed (basic polling)
		let status = run.status;
		let attempts = 0;
		while (status !== 'completed' && status !== 'failed' && attempts < 40) {
			await new Promise(r => setTimeout(r, 1500));
			const pr = await fetchFn(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, { headers });
			const pj = await pr.json();
			status = pj.status;
			attempts++;
		}
		if (status !== 'completed') {
			return res.status(500).json({ ok: false, error: `Run did not complete (status=${status})` });
		}

		// 5) list messages and collect latest assistant text
		const lm = await fetchFn(`https://api.openai.com/v1/threads/${thread.id}/messages`, { headers });
		if (!lm.ok) {
			const t = await lm.text();
			return res.status(lm.status).json({ ok: false, error: `List messages failed: ${t}` });
		}
		const list = await lm.json();
		const msgs = Array.isArray(list.data) ? list.data : [];
		const latest = msgs.find(m => m.role === 'assistant');
		let out = '';
		if (latest && Array.isArray(latest.content)) {
			const textPart = latest.content.find(c => c.type === 'text');
			out = textPart?.text?.value || '';
		}
		return res.json({ ok: true, text: out, thread_id: thread.id, run_id: run.id });
	} catch (e) {
		res.status(500).json({ ok: false, error: e?.message || String(e) });
	}
});

// ============ Interview-style endpoints (chat-driven, stateful) ============
// In-memory session store: sessionId -> { history: ChatMessage[], turns: number, createdAt: number }
const sessions = new Map();

function uuid() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

async function openaiChat(messages, { temperature = 0.3, max_tokens = 800 } = {}) {
	if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY on server');
	const models = [DEFAULT_MODEL, 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].filter(Boolean);
	let lastErr = null;
	for (const m of models) {
		try {
			const r = await fetchFn('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
				body: JSON.stringify({ model: m, messages, temperature, max_tokens, stream: false })
			});
			const txt = await r.text();
			if (!r.ok) {
				if (r.status === 401 || /api key/i.test(txt)) throw new Error('Invalid OpenAI API key');
				lastErr = new Error(`HTTP ${r.status} ${txt}`);
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

function buildInterviewSystemPrompt(language = 'en', context = {}) {
	const lang = language === 'bn' ? 'bn' : 'en';
	const languageDirective = lang === 'bn'
		? 'All patient-facing wording must be in Bangla (বাংলা). Keep your tone respectful, clear, and confident.'
		: 'Use clear, plain English that a patient can understand.';

	let documentInfo = '';
	if (context.uploads && context.uploads.length > 0) {
		const doc = context.uploads[0]; // Latest document
		documentInfo = `\nDocument Summary: ${doc.summary || 'No summary available'}\nExtracted Text Preview: ${(doc.extractedText || '').slice(0, 500)}${(doc.extractedText || '').length > 500 ? '...' : ''}`;
	}

	return (
		`You are a clinical intake assistant. Ask one question at a time to collect relevant information for a doctor. ${languageDirective}${documentInfo}\n` +
		'- Use the document content provided above to inform your questions - ask about details mentioned in the documents or follow up on findings.\n' +
		'- Always return ONLY valid JSON with keys: {"question":"<string>","done":false}.\n' +
		'- If you have enough information, return {"question":"","done":true}.\n' +
		'- Keep questions short, clear, and medically relevant.\n' +
		'- No greetings or explanations. No markdown. No code fences.'
	);
}

function buildReportSystemPrompt(language = 'en') {
	const lang = language === 'bn' ? 'bn' : 'en';
	const languageDirective = lang === 'bn'
		? 'All narrative sentences must be written in Bangla (বাংলা). Keep the headings in English as requested.'
		: 'Write the entire report in English.';
	return (
		'Return ONLY valid JSON with a single key: {"report":"<markdown>"}. ' +
		'At the very top of the markdown (before any headings), include four lines in this exact format using available context (or N/A if unknown):\n' +
		'Name: <name>\nAge: <age>\nGender: <gender>\nContact: <phone>.\n' +
		'After those lines, produce a concise, structured clinical report with headings exactly: Chief Complaint, History of Present Illness, Vitals, Probable Diagnosis, Recommendations. ' +
		languageDirective
	);
}

// Start interview
// body: { context?: any, language?: 'en' | 'bn' }
app.post('/api/v1/ai/interview/start', async (req, res) => {
	setCorsHeaders(req, res);
	try {
		const { context, language } = req.body || {};
		const lang = language === 'bn' ? 'bn' : 'en';
		const sessionId = uuid();
		const history = [
			{ role: 'system', content: buildInterviewSystemPrompt(lang, context) },
			{ role: 'user', content: JSON.stringify({ instruction: 'Begin interview now.' }) }
		];
		const content = await openaiChat(history, { temperature: 0.4, max_tokens: 1000 });
		const data = parseJSON(content, {});
		const question = typeof data?.question === 'string' && data.question.trim() ? data.question.trim() : 'What brings you in today?';
		const done = Boolean(data?.done);
		if (!done) {
			history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
		} else {
			history.push({ role: 'assistant', content: JSON.stringify({ question: '', done: true }) });
		}
		sessions.set(sessionId, { history, turns: 1, createdAt: Date.now(), language: lang });
		return res.json({ ok: true, sessionId, question, done });
	} catch (e) {
		return res.status(500).json({ ok: false, error: e?.message || String(e) });
	}
});

// Next question based on previous answer
// body: { sessionId: string, answer: string }
app.post('/api/v1/ai/interview/next', async (req, res) => {
	setCorsHeaders(req, res);
	try {
		const { sessionId, answer, language } = req.body || {};
		if (!sessionId) return res.status(400).json({ ok: false, error: 'missing sessionId' });
		const sess = sessions.get(sessionId);
		if (!sess) return res.status(400).json({ ok: false, error: 'invalid sessionId' });
		const lang = language === 'bn' ? 'bn' : sess.language || 'en';
		if (lang !== sess.language) {
			sess.language = lang;
			// Refresh system directive so future turns stay in the updated language
			if (Array.isArray(sess.history) && sess.history.length > 0 && sess.history[0]?.role === 'system') {
				// Note: We don't have the original context here, so we keep the existing system prompt
				// The language change will be reflected in future responses
			}
		}
		sess.history.push({ role: 'user', content: String(answer || '').trim() });
		sess.turns = (sess.turns || 0) + 1;
		const limitReached = sess.turns >= 15;
		const content = await openaiChat(sess.history, { temperature: 0.5, max_tokens: 1000 });
		const data = parseJSON(content, {});
		const question = typeof data?.question === 'string' ? data.question.trim() : '';
		const doneSignal = Boolean(data?.done);
		const done = doneSignal || limitReached || !question;
		if (!done) {
			sess.history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
		} else {
			sess.history.push({ role: 'assistant', content: JSON.stringify({ question: '', done: true }) });
		}
		return res.json({ ok: true, sessionId, question: done ? '' : question, done });
	} catch (e) {
		return res.status(500).json({ ok: false, error: e?.message || String(e) });
	}
});

// Internal: inspect active in-memory interview sessions (dev/ops only)
// Protected by INTERNAL_SECRET header or body field. Returns minimal session metadata.
app.get('/internal/debug-sessions', (req, res) => {
	setCorsHeaders(req, res);
	const secret = process.env.INTERNAL_SECRET;
	const provided = req.get('x-internal-secret') || req.query?.secret;
	if (!secret || provided !== secret) return res.status(401).json({ error: 'unauthorized' });
	try {
		const out = [];
		for (const [id, s] of sessions.entries()) {
			out.push({ sessionId: id, turns: s.turns || 0, createdAt: s.createdAt || null, language: s.language || null });
		}
		return res.json({ ok: true, count: out.length, sessions: out });
	} catch (err) {
		return res.status(500).json({ ok: false, error: String(err) });
	}
});

// Generate final report
// body: { sessionId: string }
app.post('/api/v1/ai/interview/report', async (req, res) => {
	setCorsHeaders(req, res);
	try {
		const { sessionId, language } = req.body || {};
		const sess = sessions.get(sessionId);
		if (!sess) return res.status(400).json({ ok: false, error: 'invalid sessionId' });
		const lang = language === 'bn' ? 'bn' : sess.language || 'en';
		const system = buildReportSystemPrompt(lang);
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
});

// Helpful handlers for wrong methods (avoid HTML 'Cannot GET')
app.all('/api/v1/ai/interview/*', (req, res, next) => {
	if (req.method !== 'POST') {
		return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
	}
	return next();
});

// In-memory storage for latest vitals from raspi
let latestVitals = { temperature: null, heartRate: null, spo2: null, timestamp: null };

// POST /api/vitals - Receive vitals data from raspi
app.post('/api/vitals', (req, res) => {
	setCorsHeaders(req, res);
  try {
    const { temperature, heartRate, spo2 } = req.body || {};
    if (typeof temperature === 'number' || typeof heartRate === 'number' || typeof spo2 === 'number') {
      latestVitals = {
        temperature: typeof temperature === 'number' ? temperature : latestVitals.temperature,
        heartRate: typeof heartRate === 'number' ? heartRate : latestVitals.heartRate,
        spo2: typeof spo2 === 'number' ? spo2 : latestVitals.spo2,
        timestamp: new Date().toISOString()
      };
      return res.json({ ok: true, message: 'Vitals updated' });
    } else {
      return res.status(400).json({ ok: false, error: 'Invalid vitals data' });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/vitals - Get latest vitals for frontend
app.get('/api/vitals', (req, res) => {
	setCorsHeaders(req, res);
  res.json(latestVitals);
});

// Export for Vercel serverless functions
export default app;

// For local development
if (process.env.NODE_ENV !== 'production') {
	process.on('unhandledRejection', (reason) => {
		console.error('[server] Unhandled Rejection:', reason);
	});
	process.on('uncaughtException', (err) => {
		console.error('[server] Uncaught Exception:', err);
	});

	try {
		const server = app.listen(PORT, () => {
			console.log(`[server] listening on http://localhost:${PORT}`);
		});
		// Extra diagnostics to detect unexpected shutdowns
		server.on('close', () => {
			console.log('[server] http server closed');
		});
		process.on('exit', (code) => {
			console.log('[server] process exit with code', code);
		});
		process.on('SIGINT', () => {
			console.log('[server] SIGINT received, shutting down');
			try { server.close(() => process.exit(0)); } catch (_) { process.exit(0); }
		});
		process.on('SIGTERM', () => {
			console.log('[server] SIGTERM received, shutting down');
			try { server.close(() => process.exit(0)); } catch (_) { process.exit(0); }
		});
	} catch (e) {
		console.error('[server] Failed to start:', e);
		process.exit(1);
	}
}

 
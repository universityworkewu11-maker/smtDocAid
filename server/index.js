import dotenv from 'dotenv';
dotenv.config();
// Minimal Express server for OpenAI proxy
import express from 'express';
import cors from 'cors';
import fetch from 'cross-fetch';

// Use global fetch if available; otherwise fall back to cross-fetch (avoid top-level await for Node compatibility)
const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : fetch;

const app = express();

// CORS configuration for Vercel serverless functions
app.use((req, res, next) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
});
// Basic request logging to debug 404/method/path issues
app.use((req, _res, next) => {
	try {
		console.log(`[req] ${req.method} ${req.url}`);
	} catch (_) {}
	next();
});
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 5001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY || '';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-2024-11-20';
const DEFAULT_ASSISTANT_ID = process.env.ASSISTANT_ID || '';

// Health under both /api/health and /health for compatibility
app.get('/health', (_req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	res.json({ ok: true, provider: 'openai', hasKey: Boolean(OPENAI_API_KEY) });
});
app.get('/api/health', (_req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	res.json({ ok: true, provider: 'openai', hasKey: Boolean(OPENAI_API_KEY) });
});

// Chat proxy: POST /api/v1/ai/chat { messages: [...], model?: string, temperature?: number, max_tokens?: number }
app.post('/api/v1/ai/chat', async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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

function buildInterviewSystemPrompt() {
	return (
		'You are a clinical intake assistant. Ask one question at a time to collect relevant information for a doctor.\n' +
		'- Always return ONLY valid JSON with keys: {"question":"<string>","done":false}.\n' +
		'- If you have enough information, return {"question":"","done":true}.\n' +
		'- Keep questions short, clear, and medically relevant.\n' +
		'- No greetings or explanations. No markdown. No code fences.'
	);
}

// Start interview
// body: { context?: any }
app.post('/api/v1/ai/interview/start', async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	try {
		const { context } = req.body || {};
		const sessionId = uuid();
		const history = [
			{ role: 'system', content: buildInterviewSystemPrompt() },
			{ role: 'user', content: JSON.stringify({ context: context || {}, instruction: 'Begin interview now.' }) }
		];
		const content = await openaiChat(history, { temperature: 0.4, max_tokens: 200 });
		const data = parseJSON(content, {});
		const question = typeof data?.question === 'string' && data.question.trim() ? data.question.trim() : 'What brings you in today?';
		const done = Boolean(data?.done);
		if (!done) {
			history.push({ role: 'assistant', content: JSON.stringify({ question, done: false }) });
		} else {
			history.push({ role: 'assistant', content: JSON.stringify({ question: '', done: true }) });
		}
		sessions.set(sessionId, { history, turns: 1, createdAt: Date.now() });
		return res.json({ ok: true, sessionId, question, done });
	} catch (e) {
		return res.status(500).json({ ok: false, error: e?.message || String(e) });
	}
});

// Next question based on previous answer
// body: { sessionId: string, answer: string }
app.post('/api/v1/ai/interview/next', async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	try {
		const { sessionId, answer } = req.body || {};
		const sess = sessions.get(sessionId);
		if (!sess) return res.status(400).json({ ok: false, error: 'invalid sessionId' });
		sess.history.push({ role: 'user', content: String(answer || '').trim() });
		sess.turns = (sess.turns || 0) + 1;
		const limitReached = sess.turns >= 15;
		const content = await openaiChat(sess.history, { temperature: 0.5, max_tokens: 200 });
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

// Generate final report
// body: { sessionId: string }
app.post('/api/v1/ai/interview/report', async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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
});

// Helpful handlers for wrong methods (avoid HTML 'Cannot GET')
app.all('/api/v1/ai/interview/*', (req, res, next) => {
	if (req.method !== 'POST') {
		return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
	}
	return next();
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

 
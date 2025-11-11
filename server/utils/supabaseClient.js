// Minimal no-op Supabase client to avoid runtime failures when not configured.
// Replace with real implementation as needed.

async function saveConversation(sessionId, userId, history, meta = {}) {
  // eslint-disable-next-line no-console
  console.log('[supabase] saveConversation', { sessionId, userId, turns: (history || []).length, meta });
  return { ok: true };
}

async function saveReport(userId, _sessionId, report) {
  // eslint-disable-next-line no-console
  console.log('[supabase] saveReport', { userId, reportLength: (report || '').length });
  return { ok: true };
}

module.exports = { saveConversation, saveReport };

import { runExtractionForDocument } from '../lib/documentExtractor.js';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node run_one.js <document-id>');
  process.exit(2);
}

(async () => {
  try {
    console.log('[run_one] Starting extraction for', id);
    const res = await runExtractionForDocument(id);
    console.log('[run_one] Result:', JSON.stringify(res));
    process.exit(0);
  } catch (err) {
    console.error('[run_one] Error:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
})();

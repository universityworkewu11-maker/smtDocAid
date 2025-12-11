#!/usr/bin/env node
// Simple utility to test pdf-parse extraction locally
const fs = require('fs');
const path = require('path');
// Ensure DOMMatrix exists in Node for pdf.js (used by pdf-parse)
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = function DOMMatrix() {};
}
const pdf = require('pdf-parse');

async function run() {
  const p = process.argv[2];
  if (!p) {
    console.error('Usage: node scripts/test_pdf_extract.js <file.pdf>');
    process.exit(1);
  }
  const filePath = path.resolve(p);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(2);
  }

  try {
    const data = fs.readFileSync(filePath);
    const out = await pdf(data);
    const text = out && out.text ? String(out.text) : '';
    console.log('--- pdf-parse result ---');
    console.log('Text length:', text.length);
    console.log('Number of pages (if available):', out.numpages || 'unknown');
    console.log('--- start of preview (first 4000 chars) ---');
    console.log(text.slice(0, 4000));
    console.log('--- end of preview ---');
    if (!text || text.trim().length === 0) {
      console.warn('No textual content was extracted. This file may be an image-only PDF (scanned).');
    }
  } catch (err) {
    console.error('pdf-parse error:');
    console.error(err && err.stack ? err.stack : err);
    process.exit(3);
  }
}

run();

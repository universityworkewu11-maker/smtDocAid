# Document Extraction Pipeline

This repository now supports automatic extraction of textual content from every uploaded medical document so that the AI interview/report flows can reference real clinical facts. This document explains how to provision the schema changes, run the extractor, and wire the results into the product experience.

## 1. Database Changes

Run `scripts/create_documents_table.sql` (or apply an equivalent migration) so that `public.documents` contains the new columns:

- `extraction_status text not null default 'pending'`
- `extracted_text text`
- `extraction_summary text`
- `extraction_error text`
- `last_extracted_at timestamptz`

Every new upload now starts in the `pending` state and advances to `processing` / `complete` / `failed` as the extractor runs.

## 2. Environment Variables

Both the backend API and the extractor need access to Supabase and OpenAI:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OPENAI_API_KEY=sk-...
ALLOWED_ORIGINS=https://smt-doc-aid.vercel.app
DOCUMENT_SUMMARY_MODEL=gpt-4o-mini  # optional override
DOCUMENT_EXTRACTION_BATCH=5         # optional batch size override
```

For local development, place these inside `server/.env`. In production (Vercel), add them through the project settings.

## 3. Running the Extractor

Install the new dependencies and run the script manually or via cron:

```bash
cd server
npm install
npm run extract-documents
```

The script (`server/scripts/documentExtractor.js`) performs the following loop:

1. Fetches pending documents from Supabase (`extraction_status` in `NULL`, `pending`, or `failed`).
2. Downloads the file from Supabase Storage.
3. Extracts text:
   - **PDF** → `pdf-parse`
   - **Images** → calls OpenAI Vision (requires `OPENAI_API_KEY`)
   - **Plain text / JSON** → raw UTF-8
4. Cleans and truncates the text to 12k characters.
5. Generates a concise bullet summary via OpenAI (optional but recommended when the key exists).
6. Updates the `documents` row with `extracted_text`, `extraction_summary`, `last_extracted_at`, and an updated `extraction_status`.

You can schedule this script using Vercel Cron, GitHub Actions, or any worker host (Render/railway/etc.) so new uploads are processed automatically.

## 4. Frontend & AI Usage

- `UploadDocumentsPage` now shows extraction status/summaries for previously uploaded files.
- `AIQuestionnairesPage` injects document summaries into the interview context and displays them in the patient sidebar.
- `MedicalAI.generateQuestionnaire` and the adaptive interview system leverage the richer `context.uploads` payload so generated questions/reports reflect vitals **and** document insights.

## 5. Monitoring & Troubleshooting

- Every document stores `extraction_error`. Surface it in the Supabase dashboard or UI to help patients re-upload problematic files.
- Use Supabase logs / Vercel `npm run extract-documents` output to spot OCR/API failures.
- Increase `DOCUMENT_EXTRACTION_BATCH` for higher throughput or decrease it to stay within API limits.

This pipeline keeps PHI inside your Supabase project while giving the AI the detailed evidence it needs to craft accurate medical summaries.

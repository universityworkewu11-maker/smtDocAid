# Deploying to Vercel

This repository contains a Create React App frontend and a `server/` backend. The following instructions prepare the frontend for deployment to Vercel and explain options for the backend.

## Frontend (recommended on Vercel)

1. Remove `proxy` from `package.json` (already removed in this repo) and configure the client to use `REACT_APP_SERVER_BASE` for API calls.
2. Add production environment variables in Vercel:
   - `REACT_APP_SUPABASE_URL`
   - `REACT_APP_SUPABASE_ANON_KEY`
   - `REACT_APP_SERVER_BASE` (URL of your backend)
   - `REACT_APP_TBL_REPORT` (optional)
3. The project includes `vercel.json` which:
   - Uses the static-build for `create-react-app` and serves `build/`.
   - Rewrites unknown routes to `/index.html` so client-side routing works.
4. Build & deploy:
   - From the Vercel dashboard, import the project and set the Environment Variables.
   - Vercel's build command is `npm run build` and output directory is `build` (the `vercel.json` already sets this).

## Backend options

### Option A — Deploy `server/` as a separate Vercel project (Recommended for simplicity)
- Import the `server/` folder as a separate project in Vercel (or deploy from a dedicated repo). It will run as a Node server or serverless functions depending on server setup.
- Set backend env vars (Supabase service role, DB URLs, API keys) in that project's settings.
- Set `REACT_APP_SERVER_BASE` in the frontend Vercel project to the backend's URL.

### Option B — Deploy backend to another host
- You can deploy the backend to Render, Fly, or DigitalOcean and point `REACT_APP_SERVER_BASE` to that URL.

### Option C — Convert backend endpoints to Vercel Serverless Functions
- Move routes to `api/` functions under the frontend repo and use Vercel Functions to serve them. This may require code changes to the server routes and is only recommended if you want a single repository deployment.

## Client-side security notes
- Never put Supabase service_role keys in the frontend. Use only the Anon key in the browser.
- Ensure Supabase RLS policies and storage rules are configured for production origin.

## SPA routing
- `vercel.json` rewrites all unrecognized routes to `/index.html`. No additional `_redirects` are required for Vercel.

## Local test before deploying

```powershell
npm run build
npx serve build
# Open the printed URL in your browser to validate the production build
```

## Environment variables on Vercel
- Project -> Settings -> Environment Variables -> Add the `REACT_APP_*` variables for Production and Preview as needed.

If you want, I can:
- Add deployment GitHub Action or Vercel Git integration instructions.
- Create example `vercel.json` to also treat `server/` as a separate build (more advanced).
- Help deploy the `server/` folder separately to Vercel or Render and wire `REACT_APP_SERVER_BASE`.

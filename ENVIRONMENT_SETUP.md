# Environment Variables Setup Guide

## 🎉 Frontend is Working!
Your React frontend is already deployed and working at: https://smt-doc-aid.vercel.app/

## 🔑 Setting Up API Keys

Your application needs two sets of environment variables:

### 1. Frontend Environment Variables (Vercel Dashboard)

**Current Status**: ✅ Already configured in `vercel.json`
- `REACT_APP_SUPABASE_URL` 
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_SUPABASE_BUCKET`
- `REACT_APP_TBL_REPORT`
- `REACT_APP_TBL_QR`

**To update these in Vercel**:
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Find your project: `smt-doc-aid`
3. Go to **Settings → Environment Variables**
4. Update/add these variables:

```
REACT_APP_SUPABASE_URL=https://cjysjpbgdisenofeccgu.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqeXNqcGJnZGlzZW5vZmVjY2d1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MDYzNjYsImV4cCI6MjA2OTk4MjM2Nn0.QBhxueOn6caLzYVTXkcXucDQNSsYRv30nd_6zOhBptY
REACT_APP_SUPABASE_BUCKET=uploads
REACT_APP_TBL_REPORT=diagnoses
REACT_APP_TBL_QR=questionnaire_responses
```

### 2. Backend Environment Variables (Separate Deployment Needed)

Your AI features need a backend server. You have two options:

## Option A: Deploy Backend to Vercel (Recommended)

### Step 1: Create Backend Vercel Project
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import the `server/` folder from your GitHub repository
4. Set framework to **"Node.js"**
5. Build command: `npm start`
6. Output directory: Leave empty

### Step 2: Set Backend Environment Variables
In the backend project settings, add:

```
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o-2024-11-20
ASSISTANT_ID= # Optional - leave empty unless using OpenAI Assistants
REACT_APP_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqeXNqcGJnZGlzZW5vZmVjY2d1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQwNjM2NiwiZXhwIjoyMDY5OTgyMzY2fQ.qH3QAsbebavCSP4S5EzuOZNn-uFIhTC51iwcijzNT9o
REACT_APP_SUPABASE_URL=https://cjysjpbgdisenofeccgu.supabase.co
PORT=5001
```

### Step 3: Update Frontend to Point to Backend
1. Go back to your **frontend** Vercel project settings
2. Add this environment variable:
```
REACT_APP_SERVER_BASE=https://your-backend-project.vercel.app
```
(Replace `your-backend-project` with the actual name from Step 1)

### Step 4: Get OpenAI API Key
1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy it and use it in the backend environment variables

## Option B: Deploy Backend to Render (Alternative)

1. Go to [Render.com](https://render.com)
2. Create new "Web Service"
3. Connect your GitHub repository
4. Set root directory to `server/`
5. Add the same environment variables as Option A
6. Use the Render URL in `REACT_APP_SERVER_BASE`

## 🔍 Testing Your Setup

1. **Frontend Test**: Visit https://smt-doc-aid.vercel.app/
2. **Backend Test**: Visit `https://your-backend-url.vercel.app/health`
3. **AI Features**: Try the AI questionnaire or chat features

## 🚨 Important Notes

- **OpenAI API Key**: Required for AI features. Costs money per API call.
- **Supabase Service Role Key**: Used for backend database operations. Keep this secret!
- **CORS**: Backend is configured to accept requests from any origin for development.

## 🆘 If You Need Help

- Frontend issues: Check browser console for errors
- Backend issues: Check server logs in Vercel dashboard
- OpenAI issues: Check API key validity and billing
- Database issues: Check Supabase dashboard
# Backend Deployment Guide

## 🚀 Step-by-Step Backend Deployment

### **Step 1: Prepare Server for Vercel**

Your server is already configured correctly! It will work with Vercel's Node.js runtime.

### **Step 2: Deploy Backend to Vercel**

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Click **"New Project"**

2. **Import Server Folder**
   - Choose **"Import Git Repository"**
   - Select your repository
   - **Important**: Set the **Root Directory** to `server/`
   - OR import the `server/` folder as a separate project

3. **Configure Build Settings**
   - **Framework Preset**: Node.js
   - **Build Command**: `npm install` (this is default)
   - **Output Directory**: Leave empty
   - **Install Command**: Leave empty

### **Step 3: Add Environment Variables**

In your **backend project** settings, add these variables:

```
OPENAI_API_KEY=your_openai_api_key_here

REACT_APP_SUPABASE_URL=your_supabase_url_here

REACT_APP_SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

PORT=5001
```

**Settings for each variable:**
- **Name**: Exactly as shown above
- **Value**: Copy the values exactly
- **Environment**: Select **"Production, Preview, Development"**

### **Step 4: Deploy and Get URL**

1. Click **"Deploy"**
2. Wait for deployment to complete
3. **Copy the backend URL** (e.g., `https://smart-doc-aid-server-abc123.vercel.app`)

### **Step 5: Connect Frontend to Backend**

1. Go to your **frontend** Vercel project
2. **Settings** → **Environment Variables**
3. Add this variable:
   ```
   REACT_APP_SERVER_BASE=https://your-backend-url.vercel.app
   ```
   (Replace with your actual backend URL)

4. **Deployments** → **"Redeploy"** the frontend

### **Step 6: Test the Setup**

1. **Test Backend Health**: Visit `https://your-backend-url.vercel.app/health`
   - Should return: `{"ok":true,"provider":"openai","hasKey":true}`

2. **Test Frontend**: Visit `https://smt-doc-aid.vercel.app/`
   - AI features should now work!

## ✅ **What You'll Get:**

- **Backend URL**: Your AI server endpoint
- **Working AI Features**: 
  - Dynamic medical questionnaires
  - AI chat assistant
  - Automated medical reports
  - Enhanced diagnostics

## 🔧 **Server Features:**
- ✅ CORS enabled for cross-origin requests
- ✅ OpenAI API integration
- ✅ Supabase database integration
- ✅ Health check endpoints
- ✅ Error handling and logging

**Your AI-powered healthcare platform will be fully operational after this deployment!**
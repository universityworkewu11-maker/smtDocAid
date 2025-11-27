// CORS helper for Vercel serverless functions
export function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://smt-doc-aid-amitubs-projects.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // Indicate that the request was handled
  }
  return false; // Continue with normal processing
}
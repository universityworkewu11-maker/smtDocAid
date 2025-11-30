export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(200).json({
    ok: true,
    provider: 'openai',
    hasKey: Boolean(process.env.OPENAI_API_KEY)
  });
}
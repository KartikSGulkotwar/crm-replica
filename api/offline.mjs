// Temporary: answers every /api request on Vercel until the API server (Railway) is connected.
// Once it is, vercel.json forwards /api to it and this file is deleted.
export default function handler(_req, res) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      statusCode: 503,
      message:
        'The CRM’s server isn’t live yet; it’s being set up. The code and screenshots are on GitHub.',
    }),
  );
}

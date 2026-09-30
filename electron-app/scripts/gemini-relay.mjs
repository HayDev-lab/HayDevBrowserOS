// Temporary diagnostic relay: logs request bodies (no auth headers) and
// forwards to Gemini; captures the exact request that returns 400.
import http from 'node:http';
const UP = 'https://generativelanguage.googleapis.com';
http.createServer(async (req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const t0 = Date.now();
    try {
      const r = await fetch(UP + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization ?? '' }, body: body || undefined });
      const t = await r.text();
      console.log(`[relay] ${req.url} -> ${r.status} (${Date.now() - t0}ms, req ${body.length}b)`);
      if (r.status >= 400) {
        const parsed = JSON.parse(body);
        console.log('[relay] FAILING REQUEST:');
        console.log('  model:', parsed.model, '| stream:', parsed.stream, '| temp:', parsed.temperature, '| tools:', (parsed.tools ?? []).map((t2) => t2.function.name).join(','));
        console.log('  response:', t.slice(0, 300));
        (await import('node:fs')).writeFileSync('C:/Users/Admin/AppData/Local/Temp/relay-fail-' + Date.now() + '.json', body);
      }
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
      res.end(t);
    } catch (e) {
      console.log('[relay] fwd error', e.message);
      res.writeHead(502); res.end('{}');
    }
  });
}).listen(39899, '127.0.0.1', () => console.log('[relay] on :39899'));

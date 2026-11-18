import { createServer } from 'node:http';
const port = Number(process.env.PORT || 4173);
createServer((req, res) => {
 if (req.url !== '/') { res.writeHead(404); res.end('Deliberate missing fixture'); return; }
 res.setHeader('Content-Type', 'text/html; charset=utf-8');
 res.end(`<!doctype html><html><head><title>Broken handoff demo</title></head><body><h1>Can you spot the handoff problems?</h1><div style="width:1600px;background:#dff;padding:20px">This card is too wide for mobile.</div><p><img src="/missing-image.png" alt="Deliberately missing picture"></p><a href="/missing-page">A broken link</a><script>setTimeout(()=>{throw new Error('Deliberate demo error')},10)</script></body></html>`);
}).listen(port, '127.0.0.1', () => console.log(`Broken demo: http://127.0.0.1:${port}`));

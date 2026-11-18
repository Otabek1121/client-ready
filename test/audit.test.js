import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit, normalizeTarget, isAllowedRequest } from '../src/audit.js';
import { escapeHtml, renderReport } from '../src/report.js';
test('target validation', () => {
 assert.equal(normalizeTarget('https://example.org/#fragment').href, 'https://example.org/');
 for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://name:password@example.org']) assert.throws(()=>normalizeTarget(value));
});
test('HTML escapes untrusted site text',()=>{
 assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
 const html = renderReport({target:'<script>alert(1)</script>',generatedAt:'now',findings:[],pages:[],checkedLinks:[],blockedRequests:0,limits:[]});
 assert.ok(!html.includes('<script>')); assert.ok(html.includes('Content-Security-Policy'));
});
test('integration: evidence, same-origin HEAD, no writes or redirect following', async()=>{
 const requests=[];
 const server=createServer((req,res)=>{
  requests.push(`${req.method} ${req.url}`);
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<html><body><h1 style="width:1800px">Broken demo</h1><img src="/missing.png"><img src="http://["><img src="/redirect-resource"><a href="#missing-section">Missing section</a><a href="#present">Present</a><div id="present"></div><a href="/dead">Dead</a><a href="/redirect">Redirect</a><a href="/unsupported">Head unsupported</a><script>fetch('/write',{method:'POST'}).catch(()=>{});setTimeout(()=>{throw new Error('fixture error')},20)</script></body></html>`);}
  else if(req.url==='/redirect-resource'){res.writeHead(302,{Location:'http://127.0.0.1:1/forbidden'});res.end();}
  else if(req.url==='/redirect'){res.writeHead(302,{Location:'/should-not-visit'});res.end();}
  else {res.statusCode=req.url==='/unsupported'?405:404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const output=await mkdtemp(join(tmpdir(),'client-ready-'));
 try {
  const report=await audit(`http://127.0.0.1:${server.address().port}`,{output,executablePath:process.env.CLIENT_READY_CHROMIUM});
  for (const check of ['metadata','overflow','image','javascript','link','link-unverified','image-invalid','redirect-blocked','fragment']) assert.ok(report.findings.some(f=>f.check===check),check);
  assert.equal(report.pages.length,2);
  assert.equal(report.findings.filter(f=>f.check==='fragment').length,2);
  assert.ok(report.findings.filter(f=>f.check==='fragment').every(f=>f.message.includes('#missing-section')));
  assert.ok(requests.every(r=>!r.startsWith('POST')));
  assert.ok(!requests.some(r=>r.includes('should-not-visit')));
  assert.ok(requests.includes('HEAD /dead'));
  assert.ok(!requests.includes('GET /dead'));
  assert.ok(report.blockedRequests>=2);
 } finally {server.close();await rm(output,{recursive:true,force:true});}
});

test('network boundary permits only same-origin GET/HEAD without credentials', () => {
 const origin = 'https://example.org';
 assert.ok(isAllowedRequest('https://example.org/a', 'GET', origin));
 assert.ok(isAllowedRequest('https://example.org/a', 'HEAD', origin));
 for (const [url, method] of [['https://example.org/a','POST'],['https://other.org/a','GET'],['https://name:password@example.org/a','GET'],['file:///etc/passwd','GET'],['not-a-url','GET']]) assert.equal(isAllowedRequest(url, method, origin), false);
});


test('audit rejects unbounded or invalid timeout before starting browser', async () => {
 for (const timeout of [0, -1, 99, 60001, Infinity, NaN, 1.5, '15000', null]) {
  await assert.rejects(audit('http://127.0.0.1:1', {timeout}), /timeout must be an integer/);
 }
});

test('slow navigation fails within configured timeout', {timeout:10000}, async () => {
 const server = createServer(() => {}); // Deliberately never responds.
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const output = await mkdtemp(join(tmpdir(), 'client-ready-timeout-'));
 try {
  await assert.rejects(audit(`http://127.0.0.1:${server.address().port}`, {output, timeout:200, executablePath:process.env.CLIENT_READY_CHROMIUM}), /Timeout|net::ERR_FAILED/);
 } finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(output, {recursive:true, force:true});
 }
});

test('each viewport starts with fresh cookies and local storage', {timeout:30000}, async () => {
 const cookies = [];
 const server = createServer((req, res) => {
  if (req.url !== '/') { res.end(); return; }
  cookies.push(req.headers.cookie || '');
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html lang="en"><head><title>Fresh visit</title></head><body><script>
   if (localStorage.getItem('visited') || document.cookie.includes('visited=')) document.title = 'Contaminated visit';
   localStorage.setItem('visited', 'yes');
   document.cookie = 'visited=yes; path=/';
  </script></body></html>`);
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const output = await mkdtemp(join(tmpdir(), 'client-ready-isolation-'));
 try {
  const report = await audit(`http://127.0.0.1:${server.address().port}`, {output, maxLinks:0, executablePath:process.env.CLIENT_READY_CHROMIUM});
  assert.deepEqual(report.pages.map(page => page.title), ['Fresh visit', 'Fresh visit']);
  assert.deepEqual(cookies, ['', '']);
 } finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(output, {recursive:true, force:true});
 }
});

test('HEAD checks include mobile-only links with global deduplication and cap', {timeout:60000}, async () => {
 const requests = [];
 const server = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  if (req.url !== '/') {res.statusCode = req.url === '/mobile-dead' ? 404 : 200; res.end(); return;}
  res.setHeader('Content-Type', 'text/html');
  res.end(`<html lang="en"><head><title>Responsive links</title></head><body>
   <a href="/shared#one">Shared</a><a href="/shared#two">Shared again</a>
   <script>const a = document.createElement('a'); a.href = innerWidth < 600 ? '/mobile-dead' : '/desktop'; a.textContent = 'Viewport link'; document.body.append(a);</script>
  </body></html>`);
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const root = await mkdtemp(join(tmpdir(), 'client-ready-responsive-'));
 try {
  for (const maxLinks of [3, 1, 0]) {
   requests.length = 0;
   const report = await audit(`http://127.0.0.1:${server.address().port}`, {output:join(root, String(maxLinks)), maxLinks, executablePath:process.env.CLIENT_READY_CHROMIUM});
   const expected = ['/shared', '/desktop', '/mobile-dead'].slice(0, maxLinks);
   assert.deepEqual(report.checkedLinks.map(link => new URL(link.url).pathname), expected);
   assert.deepEqual(requests.filter(request => request.startsWith('HEAD ')), expected.map(path => `HEAD ${path}`));
   assert.ok(!requests.some(request => /^GET \/(shared|desktop|mobile-dead)/.test(request)));
   assert.equal(report.findings.some(finding => finding.check === 'link' && finding.message.includes('/mobile-dead')), maxLinks === 3);
   const omitted = report.findings.filter(finding => finding.check === 'limit' && finding.message.includes('links omitted'));
   assert.deepEqual(omitted.map(finding => finding.message), maxLinks === 3 ? [] : [`${3 - maxLinks} links omitted by limit.`]);
  }
 } finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, {recursive:true, force:true});
 }
});

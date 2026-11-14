import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
function run(args) {
 return new Promise(resolve => execFile(process.execPath, [cli, ...args], { timeout: 30000 }, (error, stdout, stderr) => resolve({code:error?.code ?? 0, stdout, stderr})));
}

test('CLI writes all report formats, uses exit codes and preserves existing output', {timeout:90000}, async () => {
 const server = createServer((req,res) => {
  if (req.url !== '/') {res.statusCode=404;res.end('missing');return;}
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><html lang="en"><head><title>Fixture</title><meta name="description" content="demo"><meta name="viewport" content="width=device-width"></head><body><img src="/missing.png" alt="Missing fixture"></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root=await mkdtemp(join(tmpdir(),'client-ready-cli-'));
 const target=`http://127.0.0.1:${server.address().port}`;
 try {
  const out=join(root,'normal');
  const normal=await run([target,'-o',out,'--max-links','0']);
  assert.equal(normal.code,0,normal.stderr);
  const json=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
  assert.ok(json.findings.some(f=>f.check==='image' && f.severity==='error'));
  assert.ok((await readFile(join(out,'report.md'),'utf8')).includes('Image failed to decode'));
  assert.ok((await readFile(join(out,'index.html'),'utf8')).includes('Client Ready report'));
  for(const viewport of ['mobile','desktop']) assert.deepEqual([...((await readFile(join(out,`${viewport}.png`))).subarray(0,8))],[137,80,78,71,13,10,26,10]);
  const previous=await readFile(join(out,'report.md'),'utf8');
  const repeat=await run([target,'-o',out]);
  assert.equal(repeat.code,2); assert.ok(repeat.stderr.includes('must be empty'));
  assert.equal(await readFile(join(out,'report.md'),'utf8'),previous);
  const strict=await run([target,'-o',join(root,'strict'),'--max-links','0','--fail-on-error']);
  assert.equal(strict.code,1,strict.stderr);
  assert.ok((await readFile(join(root,'strict','report.md'),'utf8')).includes('Client Ready handoff report'));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

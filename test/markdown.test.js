import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';
const base = { target: 'https://example.org/', generatedAt: '2026-11-14T09:00:00Z', findings: [], checkedLinks: [], blockedRequests: 0, limits: ['One page only.'] };

test('Markdown handoff includes counts, locations, evidence and coverage', () => {
 const result = renderMarkdown({ ...base, blockedRequests: 2, checkedLinks: [{url:'/x'}], findings: [{severity:'error', check:'image', viewport:'mobile', element:'img#cover', message:'Image failed'}] });
 for (const text of ['1 error', '1 links checked', '2 requests blocked', 'ERROR · image · mobile', '    Image failed', '    img#cover', 'One page only', 'untrusted evidence', 'Review or redact']) assert.ok(result.includes(text), text);
});

test('Markdown keeps hostile multiline site text inside indented evidence', () => {
 const hostile = '\n# Forged heading\r\n```\n<img src=x>\n- [ ] fake task';
 const result = renderMarkdown({ ...base, target: hostile, findings: [{severity:'warning',check:'console',message:hostile,element:hostile}] });
 assert.ok(result.includes('    # Forged heading'));
 assert.ok(result.includes('    ```'));
 assert.ok(result.includes('    <img src=x>'));
 assert.ok(!result.includes('\n# Forged heading'));
 assert.ok(!result.includes('\n```'));
 assert.ok(!result.includes('\n<img'));
 assert.ok(!result.includes('\r'));
});

test('Empty Markdown report is not a readiness guarantee', () => {
 const result = renderMarkdown(base);
 assert.ok(result.includes('No findings in this limited sample'));
 assert.ok(result.includes('does not prove the site is ready or secure'));
});

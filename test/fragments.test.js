import test from 'node:test';
import assert from 'node:assert/strict';
import { missingFragments } from '../src/fragments.js';
const page = 'https://example.org/page?q=1';
test('fragment check finds missing unique same-page anchors', () => {
 assert.deepEqual(missingFragments(['#present', '#legacy', '#missing', '#missing', '#Present'], page, ['present','legacy']), ['missing','Present']);
});
test('fragment check decodes Unicode and spaces without treating plus as space', () => {
 assert.deepEqual(missingFragments(['#caf%C3%A9', '#a%20b', '#a+b', '#%E6%97%A0'], page, ['café','a b']), ['a+b','无']);
});
test('fragment check skips other pages, text fragments and special top links', () => {
 assert.deepEqual(missingFragments(['#', '#top', '#TOP', '#:~:text=hello', '#target:~:text=hello', '#%zz', '/elsewhere#missing', '?q=2#missing', 'https://other.org/page?q=1#missing', 'http://['], page, []), []);
});

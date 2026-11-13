#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit } from './audit.js';
import { renderReport } from './report.js';
try {
 const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, output: { type: 'string', short: 'o', default: 'client-ready-report' }, 'max-links': { type: 'string', default: '20' }, 'fail-on-error': { type: 'boolean' } } });
 if (values.help || !positionals.length) {
   console.log('Usage: node src/cli.js <URL> [-o directory] [--max-links 0..100] [--fail-on-error]\nOnly test sites you own or have permission to audit. Reports stay local.\nSet CLIENT_READY_CHROMIUM to use an existing Chromium executable.');
   if (!values.help) process.exitCode = 2;
 } else {
   if (positionals.length !== 1) throw new Error('Provide exactly one URL.');
   const report = await audit(positionals[0], { output: values.output, maxLinks: Number(values['max-links']), executablePath: process.env.CLIENT_READY_CHROMIUM });
   await writeFile(resolve(values.output, 'report.json'), JSON.stringify(report, null, 2));
   await writeFile(resolve(values.output, 'index.html'), renderReport(report));
   console.log(`Report: ${resolve(values.output, 'index.html')}\n${report.findings.length} findings. Check coverage and limits before sharing.`);
   if (values['fail-on-error'] && report.findings.some(f=>f.severity==='error')) process.exitCode = 1;
 }
} catch (error) { console.error(`Client Ready: ${error.message}`); process.exitCode = 2; }

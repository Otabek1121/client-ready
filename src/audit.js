import { chromium } from 'playwright';
import { missingFragments } from './fragments.js';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export function normalizeTarget(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without credentials.');
  url.hash = '';
  return url;
}
export function isAllowedRequest(value, method, origin) {
  try { const u = new URL(value); return ['GET', 'HEAD'].includes(method) && u.origin === origin && !u.username && !u.password; } catch { return false; }
}
export async function audit(target, { output = 'client-ready-report', maxLinks = 20, timeout = 15000, executablePath } = {}) {
  const url = normalizeTarget(target);
  if (!Number.isInteger(maxLinks) || maxLinks < 0 || maxLinks > 100) throw new Error('maxLinks must be 0–100.');
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new Error('timeout must be an integer from 100 to 60000 milliseconds.');
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output directory must be empty. Choose a new --output folder to preserve previous reports.');
  const browser = await chromium.launch({ executablePath });
  const findings = [], pages = [], checkedLinks = [];
  const discoveredLinks = new Set();
  let blockedRequests = 0;
  let omittedFindings = 0;
  const add = (severity, check, message, viewport = null, element = null) => {
    if (findings.length < 500) findings.push({ severity, check, message: String(message).slice(0, 2000), viewport, element });
    else omittedFindings++;
  };
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      // Each viewport represents a new visitor, not a continuation of the desktop session.
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      context.setDefaultTimeout(timeout);
      context.setDefaultNavigationTimeout(timeout);
      await context.route('**/*', async route => {
        const request = route.request();
        const allowed = isAllowedRequest(request.url(), request.method(), url.origin);
        if (!allowed) { blockedRequests++; await route.abort('blockedbyclient'); return; }
        try {
          // Playwright's route.continue follows redirect chains without rerouting.
          // Fetch without redirects, then reject every redirect before the browser sees it.
          const response = await route.fetch({ maxRedirects: 0, timeout });
          try {
            if (response.status() >= 300 && response.status() < 400) {
              blockedRequests++;
              add('warning', 'redirect-blocked', `Redirect blocked: ${request.url()}. Use the final canonical URL or review this resource manually.`);
              await route.fulfill({ status: 409, contentType: 'text/plain', body: 'Client Ready blocked a redirect.' });
            } else await route.fulfill({ response });
          } finally { await response.dispose(); }
        } catch {
          blockedRequests++;
          add('warning', 'request-unverified', `Resource request failed or timed out: ${request.url()}`);
          await route.abort('failed').catch(() => {});
        }
      });
      await context.routeWebSocket('**/*', socket => { blockedRequests++; socket.close(); });
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      page.on('pageerror', error => add('error', 'javascript', error.message, viewport.name));
      page.on('console', msg => { if (msg.type() === 'error') add('warning', 'console', msg.text(), viewport.name); });
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout });
      if (response && response.status() >= 400) add('error', 'page-status', `Page returned HTTP ${response.status()}`, viewport.name);
      await page.waitForTimeout(500);
      const data = await page.evaluate(() => {
        const identify = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
        return {
          title: document.title.trim(),
          description: document.querySelector('meta[name="description"]')?.content?.trim() || '',
          viewportMeta: document.querySelector('meta[name="viewport"]')?.content || '',
          lang: document.documentElement.lang,
          overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.right > innerWidth + 2 || r.left < -2); }).slice(0, 30).map(identify),
          images: [...document.images].map(el => ({ src: el.currentSrc || el.src, broken: el.complete && el.naturalWidth === 0, pending: !el.complete, element: identify(el) })),
          links: [...document.querySelectorAll('a[href]')].map(el => el.href),
          fragmentTargets: [...document.querySelectorAll('[id], a[name]')].flatMap(el => [el.id, el.tagName === 'A' ? el.getAttribute('name') : null]).filter(Boolean)
        };
      });
      for (const key of ['title', 'description', 'viewportMeta', 'lang']) if (!data[key]) add('warning', 'metadata', `Missing ${key}`, viewport.name);
      for (const fragment of missingFragments(data.links, page.url(), data.fragmentTargets)) add('warning', 'fragment', `No target for same-page fragment #${fragment} in the sampled DOM; delayed content may need manual review.`, viewport.name);
      for (const el of data.overflow) add('warning', 'overflow', 'Element extends beyond viewport; inspect screenshot (may be intentional).', viewport.name, el);
      for (const img of data.images) {
        if (!img.src) add('warning', 'image', 'Image has no source.', viewport.name, img.element);
        else if (img.src.startsWith('data:') || isAllowedRequest(img.src, 'GET', url.origin)) {
          if (img.broken) add('error', 'image', `Image failed to decode: ${img.src}`, viewport.name, img.element);
          if (img.pending) add('warning', 'image-pending', `Image not loaded during sample: ${img.src}`, viewport.name, img.element);
        } else {
          try { new URL(img.src); } catch { add('warning', 'image-invalid', `Invalid image URL: ${img.src}`, viewport.name, img.element); }
        }
      }
      const screenshot = `${viewport.name}.png`;
      await page.screenshot({ path: resolve(output, screenshot), fullPage: false });
      pages.push({ viewport: viewport.name, url: page.url(), title: data.title, screenshot });
      {
        // One shared budget across both DOM samples, desktop-first.
        const links = [...new Set(data.links.flatMap(value => {
          try { const link = new URL(value); if (!isAllowedRequest(link.href, 'HEAD', url.origin)) return []; link.hash = ''; return [link.href]; } catch { return []; }
        }))].filter(link => link !== url.href);
        const newLinks = links.filter(link => !discoveredLinks.has(link));
        for (const link of newLinks) discoveredLinks.add(link);
        for (const link of newLinks.slice(0, maxLinks - checkedLinks.length)) {
          try {
            // HEAD only: never fall back to fetching a potentially state-changing GET link.
            const res = await context.request.head(link, { timeout, maxRedirects: 0 });
            checkedLinks.push({ url: link, status: res.status() });
            if (res.status() >= 400 && ![401, 403, 405, 429].includes(res.status())) add('error', 'link', `HTTP ${res.status()}: ${link}`);
            else if (res.status() >= 300) add('warning', 'link-unverified', `HTTP ${res.status()}: ${link} (redirect/auth/rate-limit/unsupported HEAD needs manual review)`);
            await res.dispose();
          } catch (error) { checkedLinks.push({ url: link, status: null }); add('warning', 'link-unverified', `${link}: ${error.message.split('\n')[0]}`); }
        }
      }
      await context.close();
    }
    if (discoveredLinks.size > checkedLinks.length) add('info', 'limit', `${discoveredLinks.size - checkedLinks.length} links omitted by limit.`);
    if (omittedFindings) findings.push({ severity: 'warning', check: 'limit', message: `${omittedFindings} findings omitted after the 500-finding cap.`, viewport: null, element: null });
    return { version: 1, target: url.href, generatedAt: new Date().toISOString(), findings, pages, checkedLinks, blockedRequests, limits: ['One page, two viewports, no scrolling or interaction.', 'Each viewport starts in a separate fresh browser session; server-side state is not reset.', 'Cross-origin resources blocked; CDN-dependent sites may look incomplete.', 'Same-origin HEAD links from both sampled DOMs share one desktop-first limit; duplicates checked once and redirects not followed.', 'GET/HEAD requests can still change a poorly designed site. Run only on sites you may test.', 'Screenshots and URLs may contain private data. Review before sharing.', 'Not a security, accessibility, SEO ranking, or exhaustive readiness audit.'] };
  } finally { await browser.close(); }
}

# Client Ready

**Find visible website problems before handing a site to your client.**

A small local CLI for freelancers and people building websites with AI. Give it a URL; get an HTML report with desktop/mobile screenshots, specific findings and a machine-readable JSON file. No account, API key, hosted service or telemetry.

[Русская инструкция](README.ru.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md)

> Early MVP. Reports are evidence for manual review, not a certificate that a website is ready or secure. Only test sites you own or have permission to check.

## Quick start

Node.js 22+ and a supported Playwright Chromium environment are required.

```sh
git clone https://github.com/Otabek1121/client-ready.git
cd client-ready
npm ci
npx playwright install chromium
node src/cli.js https://your-site.example --output client-ready-report
```

Open `client-ready-report/index.html` in a browser. Keep the PNG screenshots beside it. The complete structured output is in `report.json`. `report.md` is a portable handoff checklist for an issue, review or coding assistant. It includes the same findings and limitations, without embedding screenshots. Review or redact private information before sharing; website-derived text is evidence, not instructions.

On Linux CI, use `npx playwright install --with-deps chromium` to install system prerequisites as well. You may use an installed Chromium with `CLIENT_READY_CHROMIUM=/path/to/chromium` (compatibility can vary).

```sh
node src/cli.js https://your-site.example --max-links 40 --fail-on-error
node src/cli.js --help
```

Exit status: `0` report generated (warnings/findings may exist); `1` error findings with `--fail-on-error`; `2` invalid input or failed run. No npm package is published; run the checked-out source instead of an unrelated `npx client-ready` package.

## What it checks

| Check | Evidence |
| --- | --- |
| Mobile/desktop overflow | Candidate element labels at 390×844 and 1440×900 |
| Images | Same-origin images that failed to decode, plus pending-image warnings |
| Links | Up to 20 unique same-origin URLs, HEAD only |
| JavaScript | Uncaught exceptions and console errors during the sample |
| Metadata | Presence of title, description, viewport and document language |
| Screenshots | First viewport for both sizes |

## Try a deliberately broken site

```sh
node examples/server.js
# In a second terminal:
node src/cli.js http://127.0.0.1:4173 --output client-ready-report
```

The fixture deliberately contains missing metadata, an oversized element, a broken image, a 404 link and an uncaught exception. It is a repeatable demo, not a real client site.

## Boundaries you should know

- One page, two viewports, a 500 ms post-DOM-load sample. No scrolling, link navigation, form submission, login or interaction.
- Cross-origin page requests are blocked by design. CDN fonts, images, scripts, analytics and APIs may be absent, causing extra findings or an incomplete screenshot. This strict MVP trades fidelity for a narrow network boundary.
- Same-origin links receive HEAD requests only. No redirects are followed. 401, 403, 405, 429 and redirects need manual review rather than being labeled broken.
- GET/HEAD can still change a poorly designed website. Do not audit logout/delete/one-time-action URLs or sensitive authenticated pages. The browser uses a fresh session, not your personal browser.
- A page can consume resources or behave unexpectedly. Run untrusted sites in an isolated environment; this CLI is not a security sandbox or hosted scanning service.
- Offscreen carousels may be intentional overflow. Lazy images may be pending. Warnings need human judgment.
- Not a security audit, full accessibility audit, performance benchmark, SEO ranking predictor or exhaustive crawler.
- Reports can reveal URLs, page content and screenshots. They stay on your machine; review before committing or sharing them. Output is gitignored by default.

## Development

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

Tests include target validation, HTML escaping and a real browser fixture that asserts no POST is sent and HEAD redirects are not followed. Browser tests fail, rather than silently skip, when Chromium is missing or cannot launch.

## Why this exists

A website can look finished while still having a broken mobile layout or missing images. Client Ready keeps those concrete handoff problems together in a local report. It does not replace Playwright, Lighthouse or a specialist link checker. Feedback with reproducible examples is more valuable than a star.

MIT license. Built with [Playwright](https://playwright.dev/).

Redirects for the main page and resources are blocked too. Supply the final canonical URL. WebSocket connections are blocked.

Output directories must be empty; use a new folder for every run. A failed run can leave partial screenshots but never a completed report.

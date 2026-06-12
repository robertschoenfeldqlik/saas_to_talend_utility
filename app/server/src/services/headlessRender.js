/**
 * Headless-browser rendering (Direction 3).
 *
 * Some "API docs" pages (e.g. help-portal SPAs) render their content with
 * JavaScript, so a static HTTP GET returns only an empty shell. When that
 * happens we render the page with a headless Chromium so the real text reaches
 * the discovery pipeline. This is best-effort and OPTIONAL: if puppeteer-core
 * or a Chromium binary isn't present (e.g. local dev), headlessAvailable()
 * returns false and the caller falls back to the static content untouched.
 *
 * NOTE: the rendered text still feeds the (probabilistic) LLM path, so it is a
 * weaker guarantee than the deterministic spec/EDMX parsers — those should be
 * preferred whenever a machine-readable spec exists.
 */
const fs = require('fs');
const logger = require('../logger');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch { /* optional dependency */ }

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

function chromiumPath() {
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

function headlessAvailable() {
  return !!puppeteer && !!chromiumPath();
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const b = await puppeteer.launch({
        executablePath: chromiumPath(),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      b.on('disconnected', () => { browserPromise = null; });
      logger.info('Headless Chromium launched');
      return b;
    })().catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

// Render a JS page with a headless browser; returns { html, text }. Best-effort.
async function renderPage(url, { timeoutMs = 25000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (compatible; SaaSToTalend/1.0; headless render)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, 800)); // let late XHR content settle
    const html = await page.content();
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    return { html: html || '', text: text || '' };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { headlessAvailable, renderPage };

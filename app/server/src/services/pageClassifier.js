/**
 * Page-type detection (the "detection schema") — given fetched content and a
 * URL, classify what we're looking at so the pipeline routes correctly and the
 * UI can tell the user what was detected. The key job: recognise a JS-rendered
 * SPA page (which a static fetch can't read) so we know to render it headless.
 *
 * Detection schema returned by classifyPage():
 * {
 *   kind: 'openapi_spec' | 'odata_metadata' | 'swagger_ui' | 'js_rendered'
 *       | 'static_docs' | 'thin' | 'unknown',
 *   isSpec: boolean,        // machine-readable spec we can parse deterministically
 *   isJsRendered: boolean,  // needs a headless browser to reveal real content
 *   confidence: 'high' | 'medium' | 'low',
 *   textLength: number,     // visible (de-tagged) text length
 *   signals: string[],      // human-readable reasons for the classification
 *   recommendation: string, // suggested next step
 * }
 */
const { detectSpec } = require('./specDiscovery');
const { isEdmx } = require('./odataMetadata');

// Strip scripts/styles/tags to approximate the text a user would actually see.
function visibleText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mk(kind, isSpec, isJsRendered, confidence, textLength, signals, recommendation) {
  return { kind, isSpec, isJsRendered, confidence, textLength, signals, recommendation };
}

function classifyPage(content, { url = '', contentType = '' } = {}) {
  const raw = String(content || '');

  // 1. Machine-readable specs — deterministic, no JS, no LLM.
  if (detectSpec(raw, contentType)) {
    return mk('openapi_spec', true, false, 'high', raw.length,
      ['OpenAPI/Swagger document'], 'Parse deterministically via the OpenAPI engine.');
  }
  if (isEdmx(raw)) {
    return mk('odata_metadata', true, false, 'high', raw.length,
      ['OData EDMX ($metadata) document'], 'Parse deterministically via the OData parser.');
  }

  const isHtml = /<html|<!doctype|<body|<div|<script/i.test(raw);
  const visible = visibleText(raw);
  const scriptCount = (raw.match(/<script\b/gi) || []).length;

  const mountNode = /<div id=["'](root|app|__next)["']|<app-root\b/i.test(raw);
  const stateBootstrap = /window\.__INITIAL_STATE__|window\.__NUXT__|__NEXT_DATA__|window\.__APOLLO_STATE__|window\.__PRELOADED_STATE__/i.test(raw);
  const needsJs = /please enable javascript|you need to enable javascript|requires javascript/i.test(raw);
  const frameworkAttr = /data-reactroot|ng-version=|data-server-rendered|id=["']__nuxt["']/i.test(raw);
  const swaggerUi = /swagger-ui|swaggerui|SwaggerUIBundle|redoc|rapidoc/i.test(raw);
  const hasSpecLink =
    /\bhref\s*=\s*["'][^"']*(open-?api|swagger|specification|\/contracts?\/|\.ya?ml)[^"']*["']/i.test(raw)
    || /["'][^"'\s<>]*(?:openapi|swagger)[^"'\s<>]*\.(?:ya?ml|json)["']/i.test(raw);

  const signals = [];
  if (mountNode) signals.push('SPA mount node');
  if (stateBootstrap) signals.push('SPA state bootstrap');
  if (needsJs) signals.push('"enable JavaScript" notice');
  if (frameworkAttr) signals.push('framework marker');
  if (scriptCount) signals.push(`${scriptCount} <script> tags`);
  signals.push(`${visible.length} chars visible text`);

  const veryLittleText = visible.length < 300;
  const strongJs = stateBootstrap || needsJs || (mountNode && veryLittleText);
  const isJsRendered = isHtml && (
    (veryLittleText && scriptCount >= 2) ||
    (strongJs && visible.length < 1500)
  );

  if (swaggerUi) {
    return mk('swagger_ui', false, isJsRendered, 'medium', visible.length,
      ['Swagger UI / Redoc shell', ...signals],
      'Resolve the embedded spec URL, then parse deterministically.');
  }
  if (isJsRendered) {
    return mk('js_rendered', false, true, strongJs ? 'high' : 'medium', visible.length,
      signals, 'Render with a headless browser before extraction — the static HTML has no usable content.');
  }
  if (veryLittleText) {
    return mk('thin', false, false, 'medium', visible.length,
      signals, 'Not enough readable content; paste a spec or OData $metadata.');
  }
  if (hasSpecLink) {
    return mk('api_doc_index', false, false, 'medium', visible.length,
      ['links to an OpenAPI/Swagger spec or contract', ...signals],
      'Follow the linked spec (.yaml/.json) and parse it deterministically.');
  }
  return mk('static_docs', false, false, 'medium', visible.length,
    signals, 'Readable docs — extract endpoints with the grounded AI pass.');
}

module.exports = { classifyPage, visibleText };

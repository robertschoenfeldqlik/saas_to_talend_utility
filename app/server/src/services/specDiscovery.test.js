const test = require('node:test');
const assert = require('node:assert');
const { detectSpec, findEmbeddedSpecUrls, conventionalSpecUrls, findConfigScriptSrcs } = require('./specDiscovery');

test('detectSpec recognizes OpenAPI JSON and YAML, rejects HTML/title', () => {
  assert.equal(detectSpec('{"openapi":"3.0.0","paths":{}}', 'application/json'), true);
  assert.equal(detectSpec('swagger: "2.0"\npaths: {}', 'text/yaml'), true);
  assert.equal(detectSpec('<html><title>Docs</title></html>', 'text/html'), false);
  assert.equal(detectSpec('SAP Help Portal | SAP Online Help', 'text/html'), false);
});

test('findEmbeddedSpecUrls extracts a Swagger UI url with no extension', () => {
  const html = `<script>const ui = SwaggerUIBundle({ url: "/v3/api-docs/public", dom_id: '#x' })</script>`;
  const urls = findEmbeddedSpecUrls(html, 'https://api.example.com/swagger-ui/index.html');
  assert.ok(urls.includes('https://api.example.com/v3/api-docs/public'));
});

test('findEmbeddedSpecUrls reads Redoc + <link rel=service-desc>, prefers json', () => {
  const html = `<redoc spec-url="https://api.example.com/openapi.yaml"></redoc>
                <link rel="service-desc" type="application/vnd.oai.openapi" href="/openapi.json">`;
  const urls = findEmbeddedSpecUrls(html, 'https://api.example.com/docs');
  assert.equal(urls[0], 'https://api.example.com/openapi.json'); // json sorted first
  assert.ok(urls.includes('https://api.example.com/openapi.yaml'));
});

test('findEmbeddedSpecUrls ignores unrelated url values', () => {
  const html = `<a href="/home">home</a><script>var x = { url: "https://cdn.example.com/app.js" }</script>`;
  assert.deepStrictEqual(findEmbeddedSpecUrls(html, 'https://x.example.com/'), []);
});

test('findEmbeddedSpecUrls catches swagger-initializer-style assignment', () => {
  const js = `window.onload = function(){ const defaultDefinitionUrl = "https://petstore.swagger.io/v2/swagger.json"; SwaggerUIBundle({ url: defaultDefinitionUrl }); }`;
  const urls = findEmbeddedSpecUrls(js, 'https://petstore.swagger.io/swagger-initializer.js');
  assert.ok(urls.includes('https://petstore.swagger.io/v2/swagger.json'));
});

test('findEmbeddedSpecUrls prefers a same-host spec when several are listed', () => {
  const js = `var services="petstore.swagger.io=https://petstore.swagger.io/v2/swagger.json,petstore3.swagger.io=https://petstore3.swagger.io/api/v3/openapi.json"`;
  const urls = findEmbeddedSpecUrls(js, 'https://petstore3.swagger.io/swagger-initializer.js');
  assert.equal(urls[0], 'https://petstore3.swagger.io/api/v3/openapi.json');
});

test('findConfigScriptSrcs finds the initializer, ignores the ui bundle', () => {
  const html = `<script src="./swagger-initializer.js"></script><script src="./swagger-ui-bundle.js"></script>`;
  const srcs = findConfigScriptSrcs(html, 'https://petstore.swagger.io/');
  assert.deepStrictEqual(srcs, ['https://petstore.swagger.io/swagger-initializer.js']);
});

test('conventionalSpecUrls builds origin + relative candidates', () => {
  const urls = conventionalSpecUrls('https://api.example.com/docs/');
  assert.ok(urls.includes('https://api.example.com/openapi.json'));
  assert.ok(urls.includes('https://api.example.com/docs/openapi.json'));
});

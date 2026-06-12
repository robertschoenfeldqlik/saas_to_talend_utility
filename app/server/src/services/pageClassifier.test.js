const test = require('node:test');
const assert = require('node:assert');
const { classifyPage } = require('./pageClassifier');

test('classifies an OpenAPI spec', () => {
  const d = classifyPage('{"openapi":"3.0.0","paths":{}}', { contentType: 'application/json' });
  assert.equal(d.kind, 'openapi_spec');
  assert.equal(d.isSpec, true);
  assert.equal(d.isJsRendered, false);
});

test('classifies an OData $metadata', () => {
  const edmx = '<edmx:Edmx Version="4.0"><EntityContainer><EntitySet Name="X" EntityType="n.X"/></EntityContainer></edmx:Edmx>';
  const d = classifyPage(edmx, { contentType: 'application/xml' });
  assert.equal(d.kind, 'odata_metadata');
  assert.equal(d.isSpec, true);
});

test('flags a JS-rendered SPA shell', () => {
  const html = `<!DOCTYPE html><html><head><title>App</title></head><body>
    <div id="root"></div>
    <script src="/a.js"></script><script src="/b.js"></script>
    <noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
  const d = classifyPage(html, { contentType: 'text/html' });
  assert.equal(d.kind, 'js_rendered');
  assert.equal(d.isJsRendered, true);
});

test('flags a Swagger UI shell as swagger_ui', () => {
  const html = `<!DOCTYPE html><html><body><div id="swagger-ui"></div>
    <script src="swagger-ui-bundle.js"></script><script src="swagger-initializer.js"></script></body></html>`;
  const d = classifyPage(html, { contentType: 'text/html' });
  assert.equal(d.kind, 'swagger_ui');
});

test('treats content-rich server-rendered docs as static_docs (not JS)', () => {
  const body = 'GET /customers returns a list. '.repeat(80); // ~2400 chars of real text
  const html = `<!DOCTYPE html><html><body><main>${body}</main><script src="/analytics.js"></script></body></html>`;
  const d = classifyPage(html, { contentType: 'text/html' });
  assert.equal(d.kind, 'static_docs');
  assert.equal(d.isJsRendered, false);
});

test('classifies a docs page that links to a spec as api_doc_index', () => {
  const body = 'See the OpenAPI specification for the full contract. '.repeat(20);
  const html = `<!DOCTYPE html><html><body><main>${body}
    <a href="dynamics-open-api">OpenAPI specification</a></main></body></html>`;
  const d = classifyPage(html, { contentType: 'text/html' });
  assert.equal(d.kind, 'api_doc_index');
  assert.equal(d.isSpec, false);
});

test('flags a near-empty page as thin', () => {
  const d = classifyPage('<html><body><h1>Welcome</h1></body></html>', { contentType: 'text/html' });
  assert.equal(d.kind, 'thin');
  assert.equal(d.isJsRendered, false);
});

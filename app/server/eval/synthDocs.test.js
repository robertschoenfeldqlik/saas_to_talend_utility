const test = require('node:test');
const assert = require('node:assert');
const { synthesizeDocs, deriveBaseUrl, authSentence } = require('./synthDocs');
const { listEndpointPaths } = require('./score');

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Acme', description: 'The Acme API.' },
  servers: [{ url: 'https://api.acme.io/v2' }],
  components: { securitySchemes: { k: { type: 'apiKey', name: 'X-Acme-Key', in: 'header' } } },
  security: [{ k: [] }],
  paths: {
    '/widgets': { get: { summary: 'List widgets', responses: { 200: { content: { 'application/json': {
      schema: { type: 'object', properties: { data: { type: 'array', items: {} } } } } } } } },
      post: { summary: 'Create a widget', responses: { 201: { description: 'created' } } } },
    '/widgets/{id}': { get: { summary: 'Get a widget', responses: { 200: { content: { 'application/json': {
      schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } } } },
  },
};

test('deriveBaseUrl reads OAS3 servers and Swagger-2 host/basePath/schemes', () => {
  assert.equal(deriveBaseUrl(SPEC), 'https://api.acme.io/v2');
  assert.equal(deriveBaseUrl({ host: 'h.example.com', basePath: '/v1', schemes: ['https'] }),
    'https://h.example.com/v1');
});

test('authSentence reflects the resolved auth method and key name', () => {
  assert.match(authSentence(SPEC), /X-Acme-Key/);
  assert.match(authSentence({ paths: {} }), /[Nn]o authentication/);
});

test('synthesized prose contains every real list path and the base URL', () => {
  const { prose } = synthesizeDocs(SPEC);
  for (const p of listEndpointPaths(SPEC)) {
    assert.ok(prose.includes(p), `prose should mention list path ${p}`);
  }
  assert.ok(prose.includes('https://api.acme.io/v2'));
});

test('prose includes distractors (by-id + mutation) so filtering is tested', () => {
  const { prose, operationCount } = synthesizeDocs(SPEC);
  assert.ok(prose.includes('GET /widgets/{id}'));   // by-id distractor present
  assert.ok(prose.includes('POST /widgets'));        // mutation distractor present
  assert.equal(operationCount, 3);
});

test('prose surfaces a list endpoint\'s query parameters (pagination must be inferable)', () => {
  const spec = {
    openapi: '3.0.0', info: { title: 'P' },
    paths: { '/items': { get: { parameters: [
      { name: 'offset', in: 'query', schema: { type: 'integer' } },
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
      { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
    ], responses: { 200: { content: { 'application/json': {
      schema: { type: 'object', properties: { data: { type: 'array', items: {} } } } } } } } } } },
  };
  const { prose } = synthesizeDocs(spec);
  assert.match(prose, /offset/);
  assert.match(prose, /limit/);
  assert.ok(!/X-Trace/.test(prose), 'header params should not be listed as query params');
});

test('prose reads like docs, not a raw spec (no openapi/paths keys)', () => {
  const { prose } = synthesizeDocs(SPEC);
  assert.ok(!prose.includes('"openapi"'));
  assert.ok(!prose.includes('"paths"'));
  assert.ok(prose.includes('## Authentication'));
});

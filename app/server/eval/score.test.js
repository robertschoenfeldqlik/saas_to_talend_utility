const test = require('node:test');
const assert = require('node:assert');
const { scoreDiscovery, expectedAuthFromSpec, engineAuthToEnum, specHasListEndpoints, scoreAgainstOracle } = require('./score');

test('engineAuthToEnum maps engine types to the lowercase enum', () => {
  assert.equal(engineAuthToEnum('API_KEY'), 'api_key');
  assert.equal(engineAuthToEnum('BEARER_TOKEN'), 'bearer_token');
  assert.equal(engineAuthToEnum(undefined), 'no_auth');
});

test('expectedAuthFromSpec returns no_auth when no schemes declared', () => {
  assert.equal(expectedAuthFromSpec({ paths: { '/x': { get: {} } } }), 'no_auth');
});

test('expectedAuthFromSpec weights by global security requirement', () => {
  // Declares basic first, but global security requires bearer everywhere.
  const spec = {
    components: { securitySchemes: {
      basicAuth: { type: 'http', scheme: 'basic' },
      bearerAuth: { type: 'http', scheme: 'bearer' },
    } },
    security: [{ bearerAuth: [] }],
    paths: { '/a': { get: {} }, '/b': { get: {} } },
  };
  assert.equal(expectedAuthFromSpec(spec), 'bearer_token');
});

test('expectedAuthFromSpec lets per-operation security win on count', () => {
  const spec = {
    components: { securitySchemes: {
      key: { type: 'apiKey', name: 'X-Key', in: 'header' },
      oauth: { type: 'oauth2' },
    } },
    paths: {
      '/a': { get: { security: [{ oauth: [] }] } },
      '/b': { get: { security: [{ oauth: [] }] } },
      '/c': { get: { security: [{ key: [] }] } },
    },
  };
  assert.equal(expectedAuthFromSpec(spec), 'oauth2');
});

test('expectedAuthFromSpec handles Swagger-2 securityDefinitions', () => {
  const spec = {
    securityDefinitions: { api_key: { type: 'apiKey', name: 'api_key', in: 'header' } },
    paths: { '/pets': { get: {} } },
  };
  assert.equal(expectedAuthFromSpec(spec), 'api_key');
});

test('scoreDiscovery computes coverage and auth match', () => {
  const spec = {
    components: { securitySchemes: { b: { type: 'http', scheme: 'bearer' } } },
    security: [{ b: [] }],
    paths: { '/users': { get: {} }, '/orders': { get: {} } },
  };
  const result = {
    baseUrl: 'https://api.example.com',
    auth: { type: 'BEARER_TOKEN' },
    endpoints: [{ path: '/users' }, { path: '/orders' }],
  };
  const s = scoreDiscovery(spec, result);
  assert.equal(s.parsed_ok, true);
  assert.equal(s.endpoint_count, 2);
  assert.equal(s.path_coverage, 1);
  assert.equal(s.has_base_url, true);
  assert.equal(s.auth_match, true);
});

test('specHasListEndpoints: true for a bare-array GET response', () => {
  const spec = { paths: { '/users': { get: { responses: { 200: {
    content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } } } } };
  assert.equal(specHasListEndpoints(spec), true);
});

test('specHasListEndpoints: true for a wrapper object with a collection-named array', () => {
  const spec = { paths: { '/orders': { get: { responses: { 200: {
    content: { 'application/json': { schema: { type: 'object', properties: {
      data: { type: 'array', items: {} }, total: { type: 'integer' } } } } } } } } } } };
  assert.equal(specHasListEndpoints(spec), true);
});

test('specHasListEndpoints: false for a single-object GET response (interzoid case)', () => {
  const spec = { paths: { '/getcitymatch': { get: { responses: { 200: {
    content: { 'application/json': { schema: { type: 'object', properties: {
      Code: { type: 'string' }, Credits: { type: 'string' } } } } } } } } } } };
  assert.equal(specHasListEndpoints(spec), false);
});

test('specHasListEndpoints: resolves an internal $ref to an array response', () => {
  const spec = {
    components: { schemas: { UserList: { type: 'array', items: { $ref: '#/components/schemas/User' } } } },
    paths: { '/users': { get: { responses: { 200: {
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UserList' } } } } } } } },
  };
  assert.equal(specHasListEndpoints(spec), true);
});

test('specHasListEndpoints: false when the only GET is a by-id lookup', () => {
  const spec = { paths: { '/users/{id}': { get: { responses: { 200: {
    content: { 'application/json': { schema: { type: 'array' } } } } } } } } };
  assert.equal(specHasListEndpoints(spec), false);
});

test('scoreAgainstOracle grades endpoints + per-field, tolerant of templates & JSONPath form', () => {
  const oracle = {
    baseUrl: 'https://api.acme.io',
    auth: { type: 'API_KEY', apiKeyName: 'X-Key' },
    endpoints: [
      { name: 'widgets', path: '/widgets{mediaTypeExtension}', recordsPath: '$.data[*]', primaryKeys: ['id'], paginationStyle: 'page' },
      { name: 'orders', path: '/orders', recordsPath: '$.results[*]', primaryKeys: ['id'], paginationStyle: 'cursor' },
    ],
  };
  const llmConfig = {
    api_url: 'https://api.acme.io', auth_method: 'api_key',
    streams: [
      { path: '/widgets', records_path: '$.data', primary_keys: ['id'], pagination_style: 'page' },   // stem + records-key match
      { path: '/orders', records_path: '$.items[*]', primary_keys: ['order_id'], pagination_style: 'offset' }, // all 3 wrong
    ],
  };
  const s = scoreAgainstOracle(oracle, llmConfig);
  assert.equal(s.matched, 2);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
  assert.equal(s.authMatch, true);
  assert.deepStrictEqual(s.field.records_path, { compared: 2, correct: 1 });    // widgets right, orders wrong
  assert.deepStrictEqual(s.field.primary_keys, { compared: 2, correct: 1 });
  assert.deepStrictEqual(s.field.pagination_style, { compared: 2, correct: 1 });
});

test('scoreAgainstOracle: missing + extra streams hit recall and precision', () => {
  const oracle = { auth: { type: 'NO_AUTH' }, endpoints: [{ path: '/a' }, { path: '/b' }] };
  const llmConfig = { auth_method: 'no_auth', streams: [{ path: '/a' }, { path: '/invented' }] };
  const s = scoreAgainstOracle(oracle, llmConfig);
  assert.equal(s.matched, 1);
  assert.equal(s.recall, 0.5);   // found 1 of 2
  assert.equal(s.precision, 0.5); // 1 of 2 returned is real
});

test('scoreDiscovery flags a hallucinated path (coverage < 1)', () => {
  const spec = { paths: { '/users': { get: {} } } };
  const result = { auth: { type: 'NO_AUTH' }, endpoints: [{ path: '/users' }, { path: '/invented' }] };
  const s = scoreDiscovery(spec, result);
  assert.equal(s.path_coverage, 0.5);
});

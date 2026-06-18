const test = require('node:test');
const assert = require('node:assert');
const { validateAndCoerceConfig } = require('./configSchema');

test('coerces a well-formed config through unchanged', () => {
  const input = {
    api_url: 'https://api.example.com',
    auth_method: 'bearer_token',
    streams: [{
      name: 'contacts', path: '/contacts', primary_keys: ['id'],
      records_path: '$.data[*]', pagination_style: 'cursor',
      params: { limit: '100' }, description: 'CRM contacts',
    }],
  };
  const { config, changes } = validateAndCoerceConfig(input);
  assert.equal(config.streams.length, 1);
  assert.deepStrictEqual(config.streams[0].primary_keys, ['id']);
  assert.equal(changes.length, 0);
});

test('coerces primary_keys string -> array and params null -> {}', () => {
  const { config, changes } = validateAndCoerceConfig({
    api_url: 'https://x.io',
    auth_method: 'no_auth',
    streams: [{ name: 'u', path: '/users', primary_keys: 'id', params: null }],
  });
  assert.deepStrictEqual(config.streams[0].primary_keys, ['id']);
  assert.deepStrictEqual(config.streams[0].params, {});
  assert.ok(changes.includes('primary_keys_coerced'));
});

test('clamps an out-of-enum pagination_style to none and an invalid auth_method', () => {
  const { config, changes } = validateAndCoerceConfig({
    api_url: 'https://x.io',
    auth_method: 'token',
    streams: [{ path: '/things', pagination_style: 'standard' }],
  });
  assert.equal(config.auth_method, 'no_auth');
  assert.equal(config.streams[0].pagination_style, 'none');
  assert.ok(changes.some((c) => c.startsWith('auth_method_invalid')));
  assert.ok(changes.some((c) => c.startsWith('pagination_style_invalid')));
});

test('fixes a records_path missing its $ and a path missing its leading slash', () => {
  const { config, changes } = validateAndCoerceConfig({
    streams: [{ path: 'orders', records_path: 'data' }],
  });
  assert.equal(config.streams[0].path, '/orders');
  assert.equal(config.streams[0].records_path, '$.data');
  assert.ok(changes.includes('records_path_jsonpath_fixed'));
});

test('strips a full URL in path down to the relative path', () => {
  const { config } = validateAndCoerceConfig({
    streams: [{ path: 'https://api.example.com/v1/users' }],
  });
  assert.equal(config.streams[0].path, '/v1/users');
});

test('drops streams with no usable path, keeps the rest', () => {
  const { config, dropped } = validateAndCoerceConfig({
    streams: [{ name: 'ok', path: '/good' }, { name: 'bad' }, 'not-an-object'],
  });
  assert.equal(config.streams.length, 1);
  assert.equal(config.streams[0].path, '/good');
  assert.equal(dropped.length, 2);
});

test('survives a non-object root', () => {
  const { config, changes } = validateAndCoerceConfig('garbage');
  assert.deepStrictEqual(config, { api_url: '', auth_method: 'no_auth', streams: [] });
  assert.ok(changes.includes('root_not_object'));
});

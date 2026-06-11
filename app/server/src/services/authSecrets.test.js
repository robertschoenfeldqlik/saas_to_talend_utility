const test = require('node:test');
const assert = require('node:assert');
const { stripAuthSecrets } = require('./authSecrets');

test('strips secret-bearing fields, keeps structural ones', () => {
  const out = stripAuthSecrets({
    type: 'bearer', token: 'secret', apiKey: 'k', password: 'p',
    clientSecret: 's', apiKeyName: 'X-API-Key', username: 'bob',
  });
  assert.deepStrictEqual(out, { type: 'bearer', apiKeyName: 'X-API-Key', username: 'bob' });
});

test('is case-insensitive on key names', () => {
  const out = stripAuthSecrets({ Token: 'x', APIKEY: 'y', type: 'none' });
  assert.deepStrictEqual(out, { type: 'none' });
});

test('handles null / non-object input', () => {
  assert.deepStrictEqual(stripAuthSecrets(null), {});
  assert.deepStrictEqual(stripAuthSecrets(undefined), {});
  assert.deepStrictEqual(stripAuthSecrets('nope'), {});
});

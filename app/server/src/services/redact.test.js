const test = require('node:test');
const assert = require('node:assert');
const { redactCredentialShapedValues, PLACEHOLDER } = require('./redact');

test('redacts a Bearer token in an Authorization header example', () => {
  const { text, redactedCount } = redactCredentialShapedValues(
    'Send: Authorization: Bearer sk-abc123DEF456ghi789JKL012');
  assert.ok(text.includes(`Authorization: Bearer ${PLACEHOLDER}`));
  assert.ok(!text.includes('sk-abc123'));
  assert.ok(redactedCount >= 1);
});

test('redacts labelled secrets in JSON-ish examples, keeps the key', () => {
  const { text } = redactCredentialShapedValues('{"api_key": "1a2b3c4d5e6f7g8h"}');
  assert.ok(text.includes('"api_key"'));
  assert.ok(text.includes(PLACEHOLDER));
  assert.ok(!text.includes('1a2b3c4d5e6f7g8h'));
});

test('redacts well-known token shapes (GitHub PAT, AWS key, JWT)', () => {
  const ghp = redactCredentialShapedValues('token ghp_0123456789abcdefghijABCDEFGHIJ012345');
  assert.ok(!ghp.text.includes('ghp_0123456789'));

  const aws = redactCredentialShapedValues('AKIAIOSFODNN7EXAMPLE in your config');
  assert.ok(!aws.text.includes('AKIAIOSFODNN7EXAMPLE'));

  const jwt = redactCredentialShapedValues(
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N');
  assert.ok(jwt.text.includes(PLACEHOLDER));
  assert.ok(jwt.redactedCount >= 1);
});

test('leaves ordinary documentation text untouched', () => {
  const doc = 'GET /v1/customers returns a list of customers. Supports ?limit=100 and ?page=2.';
  const { text, redactedCount } = redactCredentialShapedValues(doc);
  assert.equal(text, doc);
  assert.equal(redactedCount, 0);
});

test('handles empty / non-string input safely', () => {
  assert.deepStrictEqual(redactCredentialShapedValues(''), { text: '', redactedCount: 0 });
  assert.deepStrictEqual(redactCredentialShapedValues(null), { text: '', redactedCount: 0 });
});

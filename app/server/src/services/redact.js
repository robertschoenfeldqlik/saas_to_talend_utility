/**
 * Redacts credential-shaped values out of API documentation text BEFORE it is
 * sent to a hosted LLM provider (OpenAI / Anthropic / Bedrock / GitHub Models).
 *
 * The model only needs the *structure* of an API (paths, params, auth scheme
 * type) to build a config — never an actual secret. But real-world docs and
 * spec examples routinely embed live-looking tokens ("Authorization: Bearer
 * sk-...", an example `api_key` value, a JWT). Those have no business leaving
 * the network, especially for an EU-sovereignty-conscious deployment. We strip
 * them here so a cloud round-trip can never carry one out.
 *
 * This is a TEXT pass (the prompt content is freeform doc text / stripped HTML,
 * not a JSON tree), complementary to the engine's JSON-tree RedactionService
 * which scrubs probe response bodies.
 *
 * Local providers (ollama) are exempt by the caller — nothing leaves the host.
 */

const PLACEHOLDER = '[REDACTED]';

// Each entry replaces the SECRET capture group ($1 ... $2 wraps) so the
// surrounding label/format is preserved and the redaction is legible.
const RULES = [
  // Authorization: Bearer <token>  /  Authorization: Basic <base64>
  {
    re: /(Authorization\s*[:=]\s*(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._\-+/=]{8,})/gi,
    rep: (_m, p1) => p1 + PLACEHOLDER,
  },
  // Labelled secrets in JSON / form / config:  "api_key": "....",  client_secret=....
  // Key name must look like a secret; value is any non-trivial quoted/bare token.
  {
    re: /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|auth[_-]?token|x-api-key|private[_-]?key|password|passwd)["']?\s*[:=]\s*["']?)([^\s"',}{)&]{6,})/gi,
    rep: (_m, p1) => p1 + PLACEHOLDER,
  },
  // Well-known opaque token shapes (prefix-anchored so we don't maul prose):
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, rep: PLACEHOLDER },                 // OpenAI-style
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, rep: PLACEHOLDER }, // GitHub PAT
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, rep: PLACEHOLDER },        // Slack
  { re: /\bAKIA[0-9A-Z]{16}\b/g, rep: PLACEHOLDER },                    // AWS access key id
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, rep: PLACEHOLDER },              // Google API key
  // JWT (three base64url segments). Common in "example" auth headers.
  { re: /\beyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\b/g, rep: PLACEHOLDER },
];

/**
 * Redact credential-shaped values from a text blob.
 * @param {string} text
 * @returns {{ text: string, redactedCount: number }}
 */
function redactCredentialShapedValues(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: text || '', redactedCount: 0 };
  }
  let out = text;
  let redactedCount = 0;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      redactedCount += 1;
      return typeof rule.rep === 'function' ? rule.rep(...args) : rule.rep;
    });
  }
  return { text: out, redactedCount };
}

module.exports = { redactCredentialShapedValues, PLACEHOLDER };

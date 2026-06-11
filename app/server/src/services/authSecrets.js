/**
 * Shared helper: strip secret-bearing auth fields before persistence.
 *
 * Generated Talend jobs reference context.* variables, so a stored project only
 * needs the auth *shape* (type, key name/location, OAuth URLs) — never the
 * secret values, which live only transiently in the probe request. Keeping the
 * key list in one module lets both the projects router (strip on write/read)
 * and the DB layer (one-time scrub of legacy rows) share the same definition.
 */
const SECRET_AUTH_KEYS = new Set([
  'apikey', 'token', 'bearertoken', 'password', 'clientsecret',
  'refreshtoken', 'accesstoken', 'privatekey', 'secretaccesskey', 'secret',
]);

function stripAuthSecrets(authConfig) {
  const obj = (authConfig && typeof authConfig === 'object') ? authConfig : {};
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_AUTH_KEYS.has(k.toLowerCase())) continue;
    clean[k] = v;
  }
  return clean;
}

module.exports = { SECRET_AUTH_KEYS, stripAuthSecrets };

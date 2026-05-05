/**
 * Translates the frontend's auth config shape onto the Java engine's
 * AuthConfig DTO shape. The two were drifted apart (frontend uses headerName,
 * token, clientId; engine uses apiKeyName, bearerToken, oauth2ClientId), and
 * Jackson silently drops unknown fields — so without this translator the
 * generated .item files end up with default values instead of what the user
 * actually entered.
 *
 * Used at two boundaries:
 *   1. /api/projects/export bridge   (server -> engine)
 *   2. /api/engine/generate proxy    (server -> engine)
 *
 * Also normalizes the type enum: frontend uses 'bearer' but engine wants
 * 'BEARER_TOKEN', etc.
 */
function mapAuthConfig(authConfig) {
  if (!authConfig) return { type: 'NO_AUTH' };
  const t = (authConfig.type || 'none').toLowerCase();
  const typeMap = {
    'none': 'NO_AUTH',
    'no_auth': 'NO_AUTH',
    'api_key': 'API_KEY',
    'bearer': 'BEARER_TOKEN',
    'bearer_token': 'BEARER_TOKEN',
    'basic': 'BASIC',
    'oauth2': 'OAUTH2',
  };
  return {
    type: typeMap[t] || 'NO_AUTH',
    // API key
    apiKey: authConfig.apiKey || null,
    apiKeyName: authConfig.apiKeyName || authConfig.headerName || null,
    apiKeyLocation: authConfig.apiKeyLocation || authConfig.location || null,
    // Bearer
    bearerToken: authConfig.bearerToken || authConfig.token || null,
    // Basic
    username: authConfig.username || null,
    password: authConfig.password || null,
    // OAuth2
    oauth2TokenUrl: authConfig.oauth2TokenUrl || authConfig.tokenUrl || null,
    oauth2ClientId: authConfig.oauth2ClientId || authConfig.clientId || null,
    oauth2ClientSecret: authConfig.oauth2ClientSecret || authConfig.clientSecret || null,
    oauth2GrantType: authConfig.oauth2GrantType || authConfig.grantType || null,
  };
}

module.exports = { mapAuthConfig };

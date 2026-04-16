import { KeyRound, Lock, User, Shield } from 'lucide-react';

const authTypes = [
  { value: 'none', label: 'None' },
  { value: 'api_key', label: 'API Key' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'oauth2', label: 'OAuth 2.0' },
];

export default function AuthConfigPanel({ config, onChange }) {
  const type = config?.type || 'none';

  const update = (field, value) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="input-label">Auth Type</label>
        <select
          value={type}
          onChange={(e) => onChange({ type: e.target.value })}
          className="input"
        >
          {authTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {type === 'api_key' && (
        <>
          <div>
            <label className="input-label">Header Name</label>
            <input
              type="text"
              value={config.headerName || ''}
              onChange={(e) => update('headerName', e.target.value)}
              placeholder="X-API-Key"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">API Key</label>
            <input
              type="password"
              value={config.apiKey || ''}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder="Enter API key"
              className="input"
            />
          </div>
        </>
      )}

      {type === 'bearer' && (
        <div>
          <label className="input-label">Bearer Token</label>
          <input
            type="password"
            value={config.token || ''}
            onChange={(e) => update('token', e.target.value)}
            placeholder="Enter bearer token"
            className="input"
          />
        </div>
      )}

      {type === 'basic' && (
        <>
          <div>
            <label className="input-label">Username</label>
            <input
              type="text"
              value={config.username || ''}
              onChange={(e) => update('username', e.target.value)}
              placeholder="Username"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input
              type="password"
              value={config.password || ''}
              onChange={(e) => update('password', e.target.value)}
              placeholder="Password"
              className="input"
            />
          </div>
        </>
      )}

      {type === 'oauth2' && (
        <>
          <div>
            <label className="input-label">Client ID</label>
            <input
              type="text"
              value={config.clientId || ''}
              onChange={(e) => update('clientId', e.target.value)}
              placeholder="OAuth client ID"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Client Secret</label>
            <input
              type="password"
              value={config.clientSecret || ''}
              onChange={(e) => update('clientSecret', e.target.value)}
              placeholder="OAuth client secret"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Token URL</label>
            <input
              type="url"
              value={config.tokenUrl || ''}
              onChange={(e) => update('tokenUrl', e.target.value)}
              placeholder="https://auth.example.com/oauth/token"
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Scopes</label>
            <input
              type="text"
              value={config.scopes || ''}
              onChange={(e) => update('scopes', e.target.value)}
              placeholder="read write (space-separated)"
              className="input"
            />
          </div>
        </>
      )}
    </div>
  );
}

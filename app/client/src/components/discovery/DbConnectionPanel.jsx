import { Database, Server, Key, Cloud } from 'lucide-react';

// Duplicated inline to avoid fragile cross-component imports with OutputConfig
export const DB_DIALECTS = {
  postgresql: { label: 'PostgreSQL', defaultPort: '5432' },
  mysql: { label: 'MySQL', defaultPort: '3306' },
  mssql: { label: 'SQL Server', defaultPort: '1433' },
  oracle: { label: 'Oracle', defaultPort: '1521' },
  snowflake: { label: 'Snowflake', defaultPort: '443' },
  redshift: { label: 'Redshift', defaultPort: '5439' },
  bigquery: { label: 'BigQuery', defaultPort: '443' },
  sqlite: { label: 'SQLite', defaultPort: '' },
};

export default function DbConnectionPanel({ config, onChange }) {
  const cfg = config || {};
  const dialect = cfg.dialect || 'postgresql';
  const dialectMeta = DB_DIALECTS[dialect] || DB_DIALECTS.postgresql;

  const update = (patch) => {
    const next = { ...cfg, ...patch };
    if (patch.dialect && DB_DIALECTS[patch.dialect]) {
      next.port = DB_DIALECTS[patch.dialect].defaultPort;
    }
    onChange(next);
  };

  const isSqlite = dialect === 'sqlite';

  return (
    <div className="space-y-4">
      {/* Dialect chips */}
      <div>
        <label className="input-label flex items-center gap-1">
          <Database className="w-3 h-3" /> Database Type
        </label>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(DB_DIALECTS).map(([key, d]) => (
            <button
              key={key}
              type="button"
              onClick={() => update({ dialect: key })}
              className={`p-2 rounded-lg border-2 text-xs font-medium transition-all ${
                dialect === key
                  ? 'border-brand-500 bg-brand-500/5 text-brand-600'
                  : 'border-transparent'
              }`}
              style={dialect !== key
                ? { background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text))' }
                : undefined}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* SQLite is file-based — show only file path */}
      {isSqlite ? (
        <div>
          <label className="input-label">File Path</label>
          <input
            type="text"
            className="input"
            placeholder="/path/to/db.sqlite"
            value={cfg.filePath || cfg.database || ''}
            onChange={(e) => update({ filePath: e.target.value, database: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label flex items-center gap-1">
                <Server className="w-3 h-3" /> Host
              </label>
              <input
                type="text"
                className="input"
                placeholder="db.example.com"
                value={cfg.host || ''}
                onChange={(e) => update({ host: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Port</label>
              <input
                type="text"
                className="input"
                placeholder={dialectMeta.defaultPort}
                value={cfg.port || ''}
                onChange={(e) => update({ port: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Database</label>
              <input
                type="text"
                className="input"
                placeholder="my_database"
                value={cfg.database || ''}
                onChange={(e) => update({ database: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Schema</label>
              <input
                type="text"
                className="input"
                placeholder="public"
                value={cfg.schema || ''}
                onChange={(e) => update({ schema: e.target.value })}
              />
            </div>
          </div>

          {/* Snowflake-specific */}
          {dialect === 'snowflake' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label flex items-center gap-1"><Cloud className="w-3 h-3" /> Warehouse</label>
                <input
                  type="text"
                  className="input"
                  placeholder="COMPUTE_WH"
                  value={cfg.warehouse || ''}
                  onChange={(e) => update({ warehouse: e.target.value })}
                />
              </div>
              <div>
                <label className="input-label">Role</label>
                <input
                  type="text"
                  className="input"
                  placeholder="SYSADMIN"
                  value={cfg.role || ''}
                  onChange={(e) => update({ role: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* BigQuery-specific */}
          {dialect === 'bigquery' && (
            <div>
              <label className="input-label">GCP Project ID</label>
              <input
                type="text"
                className="input"
                placeholder="my-gcp-project"
                value={cfg.projectId || ''}
                onChange={(e) => update({ projectId: e.target.value })}
              />
            </div>
          )}

          {/* Credentials */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label flex items-center gap-1">
                <Key className="w-3 h-3" /> Username
              </label>
              <input
                type="text"
                className="input"
                placeholder="username"
                value={cfg.username || ''}
                onChange={(e) => update({ username: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={cfg.password || ''}
                onChange={(e) => update({ password: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!cfg.ssl}
              onChange={(e) => update({ ssl: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm" style={{ color: 'rgb(var(--color-text))' }}>Enable SSL / TLS</span>
          </label>
        </>
      )}
    </div>
  );
}

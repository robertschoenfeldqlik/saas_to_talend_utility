import { useEffect, useRef } from 'react';

const DIALECTS = [
  { id: 'postgresql', label: 'PostgreSQL', defaultPort: '5432' },
  { id: 'mysql', label: 'MySQL', defaultPort: '3306' },
  { id: 'mssql', label: 'SQL Server', defaultPort: '1433' },
  { id: 'oracle', label: 'Oracle', defaultPort: '1521' },
  { id: 'snowflake', label: 'Snowflake', defaultPort: '443' },
  { id: 'redshift', label: 'Redshift', defaultPort: '5439' },
  { id: 'bigquery', label: 'BigQuery', defaultPort: '443' },
  { id: 'sqlite', label: 'SQLite', defaultPort: '' },
];

// Map common dbt adapter types to our dialect IDs
const DBT_TYPE_MAP = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlserver: 'mssql',
  mssql: 'mssql',
  oracle: 'oracle',
  snowflake: 'snowflake',
  redshift: 'redshift',
  bigquery: 'bigquery',
  sqlite: 'sqlite',
};

export default function DbtTargetConfig({ config = {}, onChange, targetInfo }) {
  const prefilledRef = useRef(false);

  useEffect(() => {
    if (prefilledRef.current) return;
    if (!targetInfo) return;
    prefilledRef.current = true;
    const dialect = DBT_TYPE_MAP[(targetInfo.type || '').toLowerCase()] || config.dialect || 'postgresql';
    const preset = DIALECTS.find((d) => d.id === dialect) || DIALECTS[0];
    onChange({
      ...config,
      dialect,
      host: targetInfo.host || config.host || '',
      port: targetInfo.port || config.port || preset.defaultPort,
      database: targetInfo.dbname || config.database || '',
      schema: targetInfo.schema || config.schema || '',
      username: targetInfo.user || config.username || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetInfo]);

  const dialect = config.dialect || 'postgresql';
  const update = (patch) => onChange({ ...config, ...patch });

  const handleDialectChange = (id) => {
    const preset = DIALECTS.find((d) => d.id === id);
    update({
      dialect: id,
      port: preset?.defaultPort || config.port || '',
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="input-label">Target Dialect</label>
        <div className="flex items-center gap-2 flex-wrap">
          {DIALECTS.map((d) => {
            const active = dialect === d.id;
            return (
              <button
                key={d.id}
                onClick={() => handleDialectChange(d.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  active ? 'bg-brand-600 text-white' : ''
                }`}
                style={
                  !active
                    ? { background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text))' }
                    : undefined
                }
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {dialect !== 'sqlite' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Host</label>
            <input
              type="text"
              className="input"
              placeholder="localhost"
              value={config.host || ''}
              onChange={(e) => update({ host: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Port</label>
            <input
              type="text"
              className="input"
              value={config.port || ''}
              onChange={(e) => update({ port: e.target.value })}
            />
          </div>
        </div>
      )}

      {dialect === 'sqlite' && (
        <div>
          <label className="input-label">SQLite File Path</label>
          <input
            type="text"
            className="input"
            placeholder="/path/to/db.sqlite"
            value={config.filePath || ''}
            onChange={(e) => update({ filePath: e.target.value })}
          />
        </div>
      )}

      {dialect !== 'sqlite' && dialect !== 'bigquery' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Database</label>
            <input
              type="text"
              className="input"
              value={config.database || ''}
              onChange={(e) => update({ database: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Schema</label>
            <input
              type="text"
              className="input"
              value={config.schema || ''}
              onChange={(e) => update({ schema: e.target.value })}
            />
          </div>
        </div>
      )}

      {dialect === 'bigquery' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Project ID</label>
            <input
              type="text"
              className="input"
              value={config.projectId || ''}
              onChange={(e) => update({ projectId: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Dataset (schema)</label>
            <input
              type="text"
              className="input"
              value={config.schema || ''}
              onChange={(e) => update({ schema: e.target.value })}
            />
          </div>
        </div>
      )}

      {dialect === 'snowflake' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Warehouse</label>
            <input
              type="text"
              className="input"
              value={config.warehouse || ''}
              onChange={(e) => update({ warehouse: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Role</label>
            <input
              type="text"
              className="input"
              value={config.role || ''}
              onChange={(e) => update({ role: e.target.value })}
            />
          </div>
        </div>
      )}

      {dialect !== 'sqlite' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Username</label>
            <input
              type="text"
              className="input"
              value={config.username || ''}
              onChange={(e) => update({ username: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input
              type="password"
              className="input"
              value={config.password || ''}
              onChange={(e) => update({ password: e.target.value })}
            />
          </div>
        </div>
      )}

      {targetInfo && (
        <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Prefilled from profiles.yml ({targetInfo.type || 'unknown'}). Adjust as needed.
        </p>
      )}
    </div>
  );
}

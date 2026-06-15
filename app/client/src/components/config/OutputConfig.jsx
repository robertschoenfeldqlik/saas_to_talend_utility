import { FileOutput, Terminal, Database, Key, Cloud, Server } from 'lucide-react';

// Database dialect metadata — drives default port, JDBC template, and Talend component
const DB_DIALECTS = {
  postgresql: {
    label: 'PostgreSQL',
    defaultPort: '5432',
    jdbcPrefix: 'jdbc:postgresql://',
    jdbcTemplate: (c) => `jdbc:postgresql://${c.host}:${c.port}/${c.database}${c.ssl ? '?sslmode=require' : ''}`,
    driver: 'org.postgresql.Driver',
    talendComponent: 'tPostgresqlOutput',
  },
  mysql: {
    label: 'MySQL',
    defaultPort: '3306',
    jdbcPrefix: 'jdbc:mysql://',
    jdbcTemplate: (c) => `jdbc:mysql://${c.host}:${c.port}/${c.database}${c.ssl ? '?useSSL=true&requireSSL=true' : '?useSSL=false'}`,
    driver: 'com.mysql.cj.jdbc.Driver',
    talendComponent: 'tMysqlOutput',
  },
  mssql: {
    label: 'SQL Server',
    defaultPort: '1433',
    jdbcPrefix: 'jdbc:sqlserver://',
    jdbcTemplate: (c) => `jdbc:sqlserver://${c.host}:${c.port};databaseName=${c.database}${c.ssl ? ';encrypt=true' : ''}`,
    driver: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
    talendComponent: 'tMSSqlOutput',
  },
  oracle: {
    label: 'Oracle',
    defaultPort: '1521',
    jdbcPrefix: 'jdbc:oracle:thin:@',
    jdbcTemplate: (c) => `jdbc:oracle:thin:@${c.host}:${c.port}:${c.database}`,
    driver: 'oracle.jdbc.OracleDriver',
    talendComponent: 'tOracleOutput',
  },
  snowflake: {
    label: 'Snowflake',
    defaultPort: '443',
    jdbcPrefix: 'jdbc:snowflake://',
    jdbcTemplate: (c) => `jdbc:snowflake://${c.host}/?db=${c.database}&schema=${c.schema || 'PUBLIC'}&warehouse=${c.warehouse || ''}&role=${c.role || ''}`,
    driver: 'net.snowflake.client.jdbc.SnowflakeDriver',
    talendComponent: 'tSnowflakeOutput',
  },
  redshift: {
    label: 'Redshift',
    defaultPort: '5439',
    jdbcPrefix: 'jdbc:redshift://',
    jdbcTemplate: (c) => `jdbc:redshift://${c.host}:${c.port}/${c.database}${c.ssl ? '?ssl=true' : ''}`,
    driver: 'com.amazon.redshift.jdbc42.Driver',
    talendComponent: 'tRedshiftOutput',
  },
  bigquery: {
    label: 'BigQuery',
    defaultPort: '443',
    jdbcPrefix: 'jdbc:bigquery://',
    jdbcTemplate: (c) => `jdbc:bigquery://https://www.googleapis.com/bigquery/v2;ProjectId=${c.projectId || c.database}`,
    driver: 'com.simba.googlebigquery.jdbc42.Driver',
    talendComponent: 'tBigQueryOutput',
  },
  sqlite: {
    label: 'SQLite',
    defaultPort: '',
    jdbcPrefix: 'jdbc:sqlite:',
    jdbcTemplate: (c) => `jdbc:sqlite:${c.filePath || c.database}`,
    driver: 'org.sqlite.JDBC',
    talendComponent: 'tSqliteOutput',
  },
};

const WRITE_MODES = [
  { value: 'INSERT', label: 'Insert' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'INSERT_OR_UPDATE', label: 'Insert or Update (upsert)' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'INSERT_IF_NOT_EXISTS', label: 'Insert if not exists' },
];

const outputTypes = [
  {
    value: 'json',
    label: 'JSON File',
    description: 'tFileOutputJSON — Write records to a JSON file',
    icon: FileOutput,
    color: 'text-[rgb(var(--color-text-secondary))]',
    bgColor: 'bg-[rgb(var(--color-surface-alt))]',
  },
  {
    value: 'log',
    label: 'Log Row',
    description: 'tLogRow — Print records to console output',
    icon: Terminal,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  {
    value: 'database',
    label: 'Database',
    description: 'Insert into PostgreSQL, MySQL, Snowflake, Redshift, SQL Server, Oracle, BigQuery, SQLite',
    icon: Database,
    color: 'text-brand-500',
    bgColor: 'bg-brand-500/10',
  },
];

export default function OutputConfig({ value, onChange, config = {}, onConfigChange = () => {} }) {
  const dbConfig = config.database || {};
  const jsonConfig = config.json || {};
  const dialect = DB_DIALECTS[dbConfig.dialect || 'postgresql'];

  const updateDb = (patch) => {
    const next = { ...dbConfig, ...patch };
    // Auto-fill port when dialect changes
    if (patch.dialect && DB_DIALECTS[patch.dialect]) {
      next.port = DB_DIALECTS[patch.dialect].defaultPort;
    }
    // Regenerate JDBC URL if user hasn't manually overridden it
    if (!next.jdbcUrlOverridden) {
      const d = DB_DIALECTS[next.dialect || 'postgresql'];
      try { next.jdbcUrl = d.jdbcTemplate(next); } catch {}
    }
    onConfigChange({ ...config, database: next });
  };

  const updateJson = (patch) => {
    onConfigChange({ ...config, json: { ...jsonConfig, ...patch } });
  };

  return (
    <div className="space-y-3">
      {outputTypes.map((opt) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
              selected ? 'border-brand-500 bg-brand-500/5' : 'border-transparent'
            }`}
            style={!selected ? { background: 'rgb(var(--color-surface-alt))' } : undefined}
          >
            <input
              type="radio"
              name="outputType"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            <div className={`w-10 h-10 rounded-xl ${opt.bgColor} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${opt.color}`} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                {opt.label}
              </div>
              <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {opt.description}
              </div>
            </div>
            {selected && (
              <div className="ml-auto w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </label>
        );
      })}

      {/* JSON File config */}
      {value === 'json' && (
        <div className="pl-14 space-y-3">
          <div>
            <label className="input-label">Output Directory</label>
            <input
              type="text"
              className="input"
              placeholder="context.OUTPUT_DIR (or /output)"
              value={jsonConfig.outputDir || ''}
              onChange={(e) => updateJson({ outputDir: e.target.value })}
            />
            <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Leave blank to use the <code>context.OUTPUT_DIR</code> variable in Talend
            </p>
          </div>
          <div>
            <label className="input-label">Encoding</label>
            <select
              className="input"
              value={jsonConfig.encoding || 'UTF-8'}
              onChange={(e) => updateJson({ encoding: e.target.value })}
            >
              <option>UTF-8</option>
              <option>ISO-8859-1</option>
              <option>US-ASCII</option>
              <option>UTF-16</option>
            </select>
          </div>
        </div>
      )}

      {/* Database config — full panel */}
      {value === 'database' && (
        <div className="pl-14 space-y-4">
          {/* Dialect */}
          <div>
            <label className="input-label flex items-center gap-1">
              <Database className="w-3 h-3" /> Database Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(DB_DIALECTS).map(([key, d]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateDb({ dialect: key })}
                  className={`p-2 rounded-lg border-2 text-xs font-medium transition-all ${
                    (dbConfig.dialect || 'postgresql') === key
                      ? 'border-brand-500 bg-brand-500/5 text-brand-600'
                      : 'border-transparent'
                  }`}
                  style={(dbConfig.dialect || 'postgresql') !== key
                    ? { background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text))' }
                    : undefined}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label flex items-center gap-1">
                <Server className="w-3 h-3" /> Host
              </label>
              <input
                type="text"
                className="input"
                placeholder="context.DB_HOST or db.example.com"
                value={dbConfig.host || ''}
                onChange={(e) => updateDb({ host: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Port</label>
              <input
                type="text"
                className="input"
                placeholder={dialect.defaultPort}
                value={dbConfig.port || ''}
                onChange={(e) => updateDb({ port: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">
                {dbConfig.dialect === 'sqlite' ? 'File Path' : 'Database'}
              </label>
              <input
                type="text"
                className="input"
                placeholder={dbConfig.dialect === 'sqlite' ? '/path/to/db.sqlite' : 'context.DB_NAME'}
                value={dbConfig.database || ''}
                onChange={(e) => updateDb({ database: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Schema</label>
              <input
                type="text"
                className="input"
                placeholder="public"
                value={dbConfig.schema || ''}
                onChange={(e) => updateDb({ schema: e.target.value })}
              />
            </div>
          </div>

          {/* Snowflake-specific */}
          {dbConfig.dialect === 'snowflake' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label flex items-center gap-1"><Cloud className="w-3 h-3" /> Warehouse</label>
                <input
                  type="text"
                  className="input"
                  placeholder="COMPUTE_WH"
                  value={dbConfig.warehouse || ''}
                  onChange={(e) => updateDb({ warehouse: e.target.value })}
                />
              </div>
              <div>
                <label className="input-label">Role</label>
                <input
                  type="text"
                  className="input"
                  placeholder="SYSADMIN"
                  value={dbConfig.role || ''}
                  onChange={(e) => updateDb({ role: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* BigQuery-specific */}
          {dbConfig.dialect === 'bigquery' && (
            <div>
              <label className="input-label">GCP Project ID</label>
              <input
                type="text"
                className="input"
                placeholder="my-gcp-project"
                value={dbConfig.projectId || ''}
                onChange={(e) => updateDb({ projectId: e.target.value })}
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
                placeholder="context.DB_USERNAME"
                value={dbConfig.username || ''}
                onChange={(e) => updateDb({ username: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="context.DB_PASSWORD"
                value={dbConfig.password || ''}
                onChange={(e) => updateDb({ password: e.target.value })}
              />
            </div>
          </div>

          {/* Target table + write mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Target Table</label>
              <input
                type="text"
                className="input"
                placeholder="stg_api_data"
                value={dbConfig.table || ''}
                onChange={(e) => updateDb({ table: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Write Mode</label>
              <select
                className="input"
                value={dbConfig.writeMode || 'INSERT'}
                onChange={(e) => updateDb({ writeMode: e.target.value })}
              >
                {WRITE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!dbConfig.ssl}
                onChange={(e) => updateDb({ ssl: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm" style={{ color: 'rgb(var(--color-text))' }}>Enable SSL / TLS</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!dbConfig.createTable}
                onChange={(e) => updateDb({ createTable: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm" style={{ color: 'rgb(var(--color-text))' }}>Create table if not exists</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!dbConfig.truncateBeforeLoad}
                onChange={(e) => updateDb({ truncateBeforeLoad: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm" style={{ color: 'rgb(var(--color-text))' }}>Truncate before load</span>
            </label>
          </div>

          {/* Generated JDBC URL */}
          <div>
            <label className="input-label">
              JDBC URL {dbConfig.jdbcUrlOverridden ? '(overridden)' : '(auto-generated)'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input font-mono text-xs"
                value={dbConfig.jdbcUrl || dialect.jdbcTemplate(dbConfig)}
                onChange={(e) => updateDb({ jdbcUrl: e.target.value, jdbcUrlOverridden: true })}
              />
              {dbConfig.jdbcUrlOverridden && (
                <button
                  type="button"
                  onClick={() => updateDb({ jdbcUrlOverridden: false, jdbcUrl: dialect.jdbcTemplate(dbConfig) })}
                  className="btn-ghost text-xs whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Driver: <code>{dialect.driver}</code> · Talend component: <code>{dialect.talendComponent}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

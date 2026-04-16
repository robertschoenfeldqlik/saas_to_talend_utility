import { Database, FileOutput, Terminal } from 'lucide-react';

const outputTypes = [
  {
    value: 'database',
    label: 'Database',
    description: 'Write each table into a target database (per-table Talend output component)',
    icon: Database,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  {
    value: 'json',
    label: 'JSON File',
    description: 'tFileOutputJSON — dump each table to a JSON file',
    icon: FileOutput,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  {
    value: 'log',
    label: 'Log Row',
    description: 'tLogRow — print rows to console (great for quick testing)',
    icon: Terminal,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
];

const WRITE_MODES = [
  { value: 'INSERT', label: 'Insert' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'INSERT_OR_UPDATE', label: 'Insert or Update (upsert)' },
  { value: 'DELETE', label: 'Delete' },
];

const DIALECTS = ['postgresql', 'mysql', 'mssql', 'oracle', 'snowflake', 'redshift', 'bigquery', 'sqlite'];

export default function DbOutputConfig({ value, onChange, config = {}, onConfigChange = () => {} }) {
  const dbCfg = config.database || {};
  const jsonCfg = config.json || {};

  const updateDb = (patch) => onConfigChange({ ...config, database: { ...dbCfg, ...patch } });
  const updateJson = (patch) => onConfigChange({ ...config, json: { ...jsonCfg, ...patch } });

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
              name="dbOutputType"
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

      {/* Database target config */}
      {value === 'database' && (
        <div className="pl-14 space-y-3">
          <div>
            <label className="input-label">Target Dialect</label>
            <select
              className="input"
              value={dbCfg.dialect || 'postgresql'}
              onChange={(e) => updateDb({ dialect: e.target.value })}
            >
              {DIALECTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Target Table Prefix</label>
              <input
                type="text"
                className="input"
                placeholder="stg_"
                value={dbCfg.tablePrefix || ''}
                onChange={(e) => updateDb({ tablePrefix: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Write Mode</label>
              <select
                className="input"
                value={dbCfg.writeMode || 'INSERT'}
                onChange={(e) => updateDb({ writeMode: e.target.value })}
              >
                {WRITE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* JSON config */}
      {value === 'json' && (
        <div className="pl-14 space-y-3">
          <div>
            <label className="input-label">Output Directory</label>
            <input
              type="text"
              className="input"
              placeholder="context.OUTPUT_DIR (or /output)"
              value={jsonCfg.outputDir || ''}
              onChange={(e) => updateJson({ outputDir: e.target.value })}
            />
          </div>
          <div>
            <label className="input-label">Encoding</label>
            <select
              className="input"
              value={jsonCfg.encoding || 'UTF-8'}
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

      {/* Log row: no config */}
      {value === 'log' && (
        <div className="pl-14 text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
          No additional configuration required. Rows will be printed to standard output.
        </div>
      )}
    </div>
  );
}

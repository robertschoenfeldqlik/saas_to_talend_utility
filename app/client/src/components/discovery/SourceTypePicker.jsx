import { Globe, Database, FileCode } from 'lucide-react';

export default function SourceTypePicker({ onSelect }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto py-8">
      <button
        onClick={() => onSelect('api')}
        className="card-interactive p-8 flex flex-col items-center text-center gap-4 transition-all"
      >
        <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center">
          <Globe className="w-8 h-8 text-brand-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>API Source</h3>
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Point at an OpenAPI / Swagger spec or paste API docs. Generate one job per GET endpoint.
          </p>
        </div>
      </button>
      <button
        onClick={() => onSelect('database')}
        className="card-interactive p-8 flex flex-col items-center text-center gap-4 transition-all"
      >
        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center">
          <Database className="w-8 h-8 text-blue-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>Database Source</h3>
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Connect to PostgreSQL, MySQL, Snowflake, BigQuery, etc. Scan the schema and generate one job per table.
          </p>
        </div>
      </button>
      <button
        onClick={() => onSelect('dbt')}
        className="card-interactive p-8 flex flex-col items-center text-center gap-4 transition-all"
      >
        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center">
          <FileCode className="w-8 h-8 text-purple-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>dbt Project</h3>
          <p className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Upload a dbt project (ZIP, GitHub URL, or paste SQL). Convert every model into a Talend job that runs the compiled SQL via tDBRow.
          </p>
        </div>
      </button>
    </div>
  );
}

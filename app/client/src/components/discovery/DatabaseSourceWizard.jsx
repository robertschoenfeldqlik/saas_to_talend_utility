import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Zap,
  Check,
  CheckCircle,
  Table as TableIcon,
  FileOutput,
} from 'lucide-react';
import DbConnectionPanel from './DbConnectionPanel';
import TableList from './TableList';
import DbOutputConfig from './DbOutputConfig';
import {
  discoverDatabase,
  generateDbJobs,
  createProject,
  saveProjectJobs,
} from '../../api/client';

const steps = [
  { label: 'Connection', icon: Database },
  { label: 'Tables', icon: TableIcon },
  { label: 'Output', icon: FileOutput },
  { label: 'Generate', icon: Zap },
];

export default function DatabaseSourceWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [dbConfig, setDbConfig] = useState({
    dialect: 'postgresql',
    port: '5432',
    host: '',
    database: '',
    schema: '',
    username: '',
    password: '',
    ssl: false,
  });

  const [tables, setTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState(new Set());

  const [outputType, setOutputType] = useState('log');
  const [outputConfig, setOutputConfig] = useState({
    database: { dialect: 'postgresql', writeMode: 'INSERT', tablePrefix: 'stg_' },
    json: { outputDir: '', encoding: 'UTF-8' },
  });

  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [generatedJobs, setGeneratedJobs] = useState(null);

  const handleConnect = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await discoverDatabase(dbConfig);
      const ts = result.tables || [];
      if (ts.length === 0) {
        setError('Connected, but no tables were found in the target schema.');
        setScanning(false);
        return;
      }
      setTables(ts);
      setSelectedTables(new Set(ts.map((t) => t.tableName || t.name)));
      setStep(1);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Connection failed';
      setError(`Failed to connect: ${msg}`);
    } finally {
      setScanning(false);
    }
  };

  const toggleTable = (name) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleAllTables = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables.map((t) => t.tableName || t.name)));
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const selected = tables.filter((t) => selectedTables.has(t.tableName || t.name));
      const projectName = dbConfig.database || dbConfig.host || 'Database Project';
      const flatOutputConfig = {
        outputType,
        ...(outputConfig?.[outputType] || {}),
      };
      const result = await generateDbJobs({
        sourceConfig: dbConfig,
        selectedTables: selected,
        outputConfig: flatOutputConfig,
        projectName,
      });

      // Save as project
      const project = await createProject({
        name: projectName,
        apiName: projectName,
        baseUrl: dbConfig.host || '',
        authConfig: { type: 'database', dialect: dbConfig.dialect },
      });

      if (result.jobs) {
        const enriched = result.jobs.map((j) => {
          const tn = (t) => t?.tableName || t?.name;
          const tbl = selected.find((t) => tn(t) === j.name || tn(t) === j.table) || {};
          return {
            ...j,
            config: {
              table: tn(tbl),
              schema: tbl.schema,
              columns: tbl.columns,
              primaryKeys: tbl.primaryKeys,
              outputType,
              output: outputConfig?.[outputType] || {},
            },
          };
        });
        await saveProjectJobs(project.id, enriched);
      }

      setGeneratedJobs(result);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Generation failed';
      setError(`Generation failed: ${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 flex-wrap">
        {steps.map(({ label, icon: Icon }, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                i === step
                  ? 'bg-brand-600 text-white'
                  : i < step
                    ? 'bg-brand-500/10 text-brand-600'
                    : ''
              }`}
              style={
                i > step
                  ? { background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text-muted))' }
                  : undefined
              }
            >
              {i < step ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              {label}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className="w-4 h-4" style={{ color: 'rgb(var(--color-text-muted))' }} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Connection */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
              Database Connection
            </h3>
            <DbConnectionPanel config={dbConfig} onChange={setDbConfig} />
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleConnect}
              disabled={scanning}
              className="btn-primary flex items-center gap-2"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {scanning ? 'Connecting & Scanning...' : 'Connect & Scan'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Tables */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                Discovered Tables ({tables.length})
              </h3>
              <span className="badge">{selectedTables.size} selected</span>
            </div>
            <TableList
              tables={tables}
              selectedNames={selectedTables}
              onToggle={toggleTable}
              onToggleAll={toggleAllTables}
            />
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(0)} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={selectedTables.size === 0}
              className="btn-primary flex items-center gap-2"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Output */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
              Output Configuration
            </h3>
            <DbOutputConfig
              value={outputType}
              onChange={setOutputType}
              config={outputConfig}
              onConfigChange={setOutputConfig}
            />
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(1)} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={() => setStep(3)} className="btn-primary flex items-center gap-2">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generate */}
      {step === 3 && (
        <div className="space-y-6">
          {!generatedJobs ? (
            <>
              <div className="card p-6">
                <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
                  Generation Summary
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-brand-600">{selectedTables.size}</div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>Tables Selected</div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-blue-600 capitalize">{dbConfig.dialect}</div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>Source Dialect</div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-purple-600 uppercase">{outputType}</div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>Output</div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button onClick={() => setStep(2)} className="btn-secondary flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="btn-primary flex items-center gap-2"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {generating ? 'Generating Talend Jobs...' : 'Generate Talend Jobs'}
                </button>
              </div>

              {generating && (
                <div className="card p-8 text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-brand-500 mx-auto mb-4" />
                  <p className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
                    Generating per-table Talend job definitions...
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    Creating tDBInput, schema mapping, and output components
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="card p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-brand-500" />
              </div>
              <h3 className="text-xl font-bold mb-2" style={{ color: 'rgb(var(--color-text))' }}>
                Jobs Generated Successfully
              </h3>
              <p className="text-sm mb-6" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                Created {generatedJobs.jobs?.length || 0} Talend job definitions
              </p>

              {generatedJobs.jobs && (
                <div className="max-w-md mx-auto mb-6 text-left space-y-2">
                  {generatedJobs.jobs.map((job, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-xl"
                      style={{ background: 'rgb(var(--color-surface-alt))' }}
                    >
                      <CheckCircle className="w-4 h-4 text-brand-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'rgb(var(--color-text))' }}>
                          {job.name}
                        </div>
                        <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                          {job.table || job.endpoint}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <button onClick={() => navigate('/jobs')} className="btn-primary">
                  View Jobs
                </button>
                <button onClick={() => navigate('/export')} className="btn-secondary">
                  Export Workspace
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

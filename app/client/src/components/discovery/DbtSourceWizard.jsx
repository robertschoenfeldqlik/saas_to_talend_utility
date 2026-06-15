import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileCode,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Zap,
  Check,
  CheckCircle,
  Layers,
  Server,
  Database,
} from 'lucide-react';
import DbtSourceInput from './DbtSourceInput';
import DbtModelList from './DbtModelList';
import DbtTargetConfig from './DbtTargetConfig';
import {
  generateDbtJobs,
  createProject,
  saveProjectJobs,
} from '../../api/client';

const steps = [
  { label: 'Source', icon: FileCode },
  { label: 'Models', icon: Layers },
  { label: 'Target', icon: Server },
  { label: 'Generate', icon: Zap },
];

export default function DbtSourceWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [parseResult, setParseResult] = useState(null);
  const [selectedModels, setSelectedModels] = useState(new Set());

  const [targetDialect, setTargetDialect] = useState('postgresql');
  const [targetConfig, setTargetConfig] = useState({
    dialect: 'postgresql',
    host: '',
    port: '5432',
    database: '',
    schema: '',
    username: '',
    password: '',
  });

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [generatedJobs, setGeneratedJobs] = useState(null);

  const handleParsed = (result) => {
    setParseResult(result);
    const all = new Set((result.models || []).map((m) => m.name));
    setSelectedModels(all);
    setError(null);
    if ((result.models || []).length === 0) {
      setError('Parsed successfully but no dbt models were found.');
      return;
    }
    setStep(1);
  };

  const toggleModel = (name) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllModels = () => {
    if (!parseResult?.models) return;
    if (selectedModels.size === parseResult.models.length) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(parseResult.models.map((m) => m.name)));
    }
  };

  const handleTargetChange = (cfg) => {
    setTargetConfig(cfg);
    if (cfg.dialect) setTargetDialect(cfg.dialect);
  };

  const handleGenerate = async () => {
    if (!parseResult) return;
    setGenerating(true);
    setError(null);
    try {
      const selectedModelObjs = parseResult.models.filter((m) => selectedModels.has(m.name));
      const result = await generateDbtJobs({
        projectName: parseResult.projectName,
        targetDialect,
        targetConfig,
        models: selectedModelObjs,
      });

      const project = await createProject({
        name: parseResult.projectName,
        apiName: parseResult.projectName,
        baseUrl: targetConfig.host || '',
        authConfig: { type: 'dbt', dialect: targetDialect, targetConfig },
      });

      if (result.jobs) {
        const enriched = result.jobs.map((j) => {
          const srcModel = selectedModelObjs.find((m) => m.name === j.name);
          return {
            ...j,
            config: {
              modelName: j.name,
              layer: j.layer,
              sql: srcModel?.sql || '',
              path: srcModel?.path || '',
              targetDialect,
              targetConfig,
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

  const layerCounts = () => {
    if (!parseResult?.models) return {};
    const counts = { staging: 0, intermediate: 0, marts: 0, other: 0 };
    for (const m of parseResult.models) {
      if (selectedModels.has(m.name)) counts[m.layer || 'other'] = (counts[m.layer || 'other'] || 0) + 1;
    }
    return counts;
  };

  return (
    <div className="animate-fade-in-up">
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

      {/* Step 0: Source */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
              dbt Project Source
            </h3>
            <DbtSourceInput onParsed={handleParsed} />
          </div>
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Step 1: Models */}
      {step === 1 && parseResult && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
                  {parseResult.projectName} — Models ({parseResult.models.length})
                </h3>
                <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {Object.entries(layerCounts())
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${v} ${k}`)
                    .join(' · ') || '0 selected'}
                </p>
              </div>
              <span className="badge">{selectedModels.size} selected</span>
            </div>
            <DbtModelList
              models={parseResult.models}
              selectedNames={selectedModels}
              onToggle={toggleModel}
              onToggleAll={toggleAllModels}
            />
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(0)} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={selectedModels.size === 0}
              className="btn-primary flex items-center gap-2"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Target */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
              Target Database
            </h3>
            <DbtTargetConfig
              config={targetConfig}
              onChange={handleTargetChange}
              targetInfo={parseResult?.targetInfo}
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
      {step === 3 && parseResult && (
        <div className="space-y-6">
          {!generatedJobs ? (
            <>
              <div className="card p-6">
                <h3 className="text-base font-semibold mb-4" style={{ color: 'rgb(var(--color-text))' }}>
                  Generation Summary
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-brand-600">{selectedModels.size}</div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      Models Selected
                    </div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-brand-600 capitalize">{targetDialect}</div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      Target Dialect
                    </div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'rgb(var(--color-surface-alt))' }}>
                    <div className="text-2xl font-bold text-brand-600 truncate">
                      {parseResult.projectName}
                    </div>
                    <div className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      Project
                    </div>
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
                    Converting dbt models into Talend jobs...
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    Each model becomes a tDBRow running the compiled SQL
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
                  {generatedJobs.jobs.slice(0, 20).map((job, i) => (
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
                          {job.layer || 'model'}
                        </div>
                      </div>
                    </div>
                  ))}
                  {generatedJobs.jobs.length > 20 && (
                    <div className="text-xs text-center" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      ...and {generatedJobs.jobs.length - 20} more
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <button onClick={() => navigate('/jobs')} className="btn-primary flex items-center gap-2">
                  <Database className="w-4 h-4" /> View Jobs
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

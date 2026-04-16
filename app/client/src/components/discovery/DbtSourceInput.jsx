import { useState } from 'react';
import { Loader2, Upload, Github, FileCode, Plus, Trash2, AlertCircle } from 'lucide-react';
import { uploadDbtZip, fetchDbtRepo, parseDbtSql } from '../../api/client';

export default function DbtSourceInput({ onParsed }) {
  const [tab, setTab] = useState('github'); // github | zip | paste
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // GitHub tab
  const [githubUrl, setGithubUrl] = useState('');

  // Paste tab
  const [projectName, setProjectName] = useState('my_project');
  const [files, setFiles] = useState([
    { path: 'models/staging/stg_example.sql', content: '' },
  ]);

  const handleFetchRepo = async () => {
    if (!githubUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDbtRepo(githubUrl.trim());
      onParsed(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch repo');
    } finally {
      setLoading(false);
    }
  };

  const handleZipSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await uploadDbtZip(file);
      onParsed(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to parse ZIP');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleParseSql = async () => {
    setLoading(true);
    setError(null);
    try {
      const validFiles = files.filter((f) => f.path && f.content);
      if (!validFiles.length) {
        setError('Add at least one file with path and SQL content');
        setLoading(false);
        return;
      }
      const res = await parseDbtSql({ projectName, files: validFiles });
      onParsed(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to parse SQL');
    } finally {
      setLoading(false);
    }
  };

  const updateFile = (idx, patch) => {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const addFile = () => setFiles((prev) => [...prev, { path: '', content: '' }]);
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const tabs = [
    { id: 'github', label: 'GitHub URL', icon: Github },
    { id: 'zip', label: 'ZIP Upload', icon: Upload },
    { id: 'paste', label: 'Paste SQL', icon: FileCode },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                active ? 'bg-brand-600 text-white' : ''
              }`}
              style={
                !active
                  ? { background: 'rgb(var(--color-surface-alt))', color: 'rgb(var(--color-text))' }
                  : undefined
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* GitHub tab */}
      {tab === 'github' && (
        <div className="space-y-3">
          <div>
            <label className="input-label">GitHub Repository URL</label>
            <input
              type="text"
              className="input"
              placeholder="https://github.com/dbt-labs/jaffle_shop"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
            <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Supports /tree/&lt;ref&gt;/&lt;subpath&gt; for branches and sub-directories.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleFetchRepo}
              disabled={loading || !githubUrl.trim()}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
              {loading ? 'Parsing...' : 'Fetch repo'}
            </button>
          </div>
        </div>
      )}

      {/* ZIP tab */}
      {tab === 'zip' && (
        <div className="space-y-3">
          <label
            className="block p-8 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all"
            style={{ borderColor: 'rgb(var(--color-border))', background: 'rgb(var(--color-surface-alt))' }}
          >
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleZipSelect}
              disabled={loading}
            />
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
                <span className="text-sm">Parsing ZIP...</span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: 'rgb(var(--color-text-muted))' }} />
                <div className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>
                  Drop a dbt project ZIP here, or click to select
                </div>
                <div className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Max 50 MB. Must contain models/ and dbt_project.yml
                </div>
              </>
            )}
          </label>
        </div>
      )}

      {/* Paste tab */}
      {tab === 'paste' && (
        <div className="space-y-3">
          <div>
            <label className="input-label">Project Name</label>
            <input
              type="text"
              className="input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            {files.map((f, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl space-y-2"
                style={{ background: 'rgb(var(--color-surface-alt))' }}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="models/staging/stg_users.sql"
                    value={f.path}
                    onChange={(e) => updateFile(idx, { path: e.target.value })}
                  />
                  {files.length > 1 && (
                    <button
                      onClick={() => removeFile(idx)}
                      className="btn-ghost p-2"
                      aria-label="Remove file"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
                <textarea
                  className="input font-mono text-xs"
                  rows={8}
                  placeholder="-- paste model SQL here"
                  value={f.content}
                  onChange={(e) => updateFile(idx, { content: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={addFile} className="btn-secondary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add file
            </button>
            <button
              onClick={handleParseSql}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
              {loading ? 'Parsing...' : 'Parse SQL'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

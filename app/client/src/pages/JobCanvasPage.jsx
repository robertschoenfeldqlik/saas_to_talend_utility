import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import JobCanvas from '../components/canvas/JobCanvas';
import NodeConfigPanel from '../components/canvas/NodeConfigPanel';

// Demo job data for when no real data is available
const demoJob = {
  id: 'demo',
  name: 'REST_API_Extract',
  endpoint: '/api/v1/users',
  status: 'generated',
  config: {
    nodes: [
      {
        id: 'rest-1',
        type: 'tRESTClient',
        label: 'tRESTClient',
        color: '#3B82F6',
        params: {
          URL: { type: 'TEXT', value: 'https://api.example.com/v1/users' },
          HTTP_METHOD: { type: 'CLOSED_LIST', value: 'GET', options: ['GET', 'POST', 'PUT', 'DELETE'] },
          CONTENT_TYPE: { type: 'CLOSED_LIST', value: 'application/json', options: ['application/json', 'application/xml', 'text/plain'] },
          NEED_AUTH: { type: 'CHECK', value: true },
          AUTH_TYPE: { type: 'CLOSED_LIST', value: 'Bearer Token', options: ['None', 'Basic', 'Bearer Token', 'API Key'] },
        },
      },
      {
        id: 'extract-1',
        type: 'tExtractJSONFields',
        label: 'tExtractJSONFields',
        color: '#22C55E',
        params: {
          JSON_PATH: { type: 'TEXT', value: '$.data[*]' },
          FIELDS: { type: 'TEXT', value: 'id, name, email, created_at' },
        },
      },
      {
        id: 'output-json',
        type: 'tFileOutputJSON',
        label: 'tFileOutputJSON',
        color: '#8B5CF6',
        params: {
          FILE_PATH: { type: 'TEXT', value: '/output/users.json' },
          ENCODING: { type: 'CLOSED_LIST', value: 'UTF-8', options: ['UTF-8', 'ISO-8859-1', 'US-ASCII'] },
          APPEND: { type: 'CHECK', value: false },
        },
      },
      {
        id: 'log-1',
        type: 'tLogRow',
        label: 'tLogRow',
        color: '#F59E0B',
        params: {
          TABLE_FORMAT: { type: 'CHECK', value: true },
          PRINT_CONTENT_WITH: { type: 'CLOSED_LIST', value: '"|"', options: ['"|"', '","', '";"', '"\\t"'] },
        },
      },
    ],
    edges: [
      { source: 'rest-1', target: 'extract-1', label: 'Main' },
      { source: 'extract-1', target: 'output-json', label: 'Main' },
      { source: 'extract-1', target: 'log-1', label: 'Copy' },
    ],
  },
};

export default function JobCanvasPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to load from API, fall back to demo
    loadJob();
  }, [id]);

  const loadJob = async () => {
    try {
      // For now, use demo data — real loading would fetch from API
      setJob(demoJob);
    } catch (err) {
      console.error('Failed to load job:', err);
      setJob(demoJob);
    } finally {
      setLoading(false);
    }
  };

  const handleNodeSelect = useCallback((node) => {
    setSelectedNode(node);
  }, []);

  const handleNodeUpdate = useCallback((nodeId, params) => {
    setJob((prev) => {
      if (!prev) return prev;
      const config = { ...prev.config };
      config.nodes = config.nodes.map((n) =>
        n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n,
      );
      return { ...prev, config };
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b shrink-0"
        style={{
          background: 'rgb(var(--color-surface))',
          borderColor: 'rgb(var(--color-border))',
        }}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/jobs')}
            className="btn-ghost flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Jobs
          </button>
          <div className="h-5 w-px" style={{ background: 'rgb(var(--color-border))' }} />
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
              {job.name}
            </h2>
            <p className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              {job.config.nodes.length} components
            </p>
          </div>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm">
          <Download className="w-4 h-4" />
          Export This Job
        </button>
      </div>

      {/* Canvas + Config Panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <JobCanvas
            nodes={job.config.nodes}
            edges={job.config.edges}
            onNodeSelect={handleNodeSelect}
          />
        </div>
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}

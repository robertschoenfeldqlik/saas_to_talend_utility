import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CanvasNode from './CanvasNode';

const nodeTypes = { canvasNode: CanvasNode };

function buildReactFlowNodes(nodes) {
  return nodes.map((node, i) => ({
    id: node.id,
    type: 'canvasNode',
    position: { x: 80 + i * 280, y: 100 + (i % 2 === 0 ? 0 : 60) },
    data: {
      label: node.label || node.type,
      type: node.type,
      color: node.color,
      params: node.params,
    },
  }));
}

function buildReactFlowEdges(edges) {
  return edges.map((edge, i) => ({
    id: `e-${i}`,
    source: edge.source,
    target: edge.target,
    label: edge.label || '',
    animated: true,
    style: { stroke: '#009845', strokeWidth: 2 },
    labelStyle: { fill: 'rgb(107, 114, 128)', fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: 'rgb(249, 250, 251)', fillOpacity: 0.9 },
    markerEnd: { type: 'arrowclosed', color: '#009845' },
  }));
}

export default function JobCanvas({ nodes: inputNodes, edges: inputEdges, onNodeSelect }) {
  const initialNodes = useMemo(() => buildReactFlowNodes(inputNodes || []), [inputNodes]);
  const initialEdges = useMemo(() => buildReactFlowEdges(inputEdges || []), [inputEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-sync when the parent updates nodes/edges (e.g. after a node-config
  // save). useNodesState/useEdgesState only seed from their argument on mount,
  // so without this the visual graph stays stale until the component remounts.
  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);

  const onNodeClick = useCallback(
    (_event, node) => {
      const sourceNode = inputNodes.find((n) => n.id === node.id);
      if (sourceNode && onNodeSelect) {
        onNodeSelect(sourceNode);
      }
    },
    [inputNodes, onNodeSelect],
  );

  return (
    <div className="w-full h-full" style={{ background: 'rgb(var(--color-bg))' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          position="bottom-left"
          style={{
            background: 'rgb(var(--color-surface))',
            border: '1px solid rgb(var(--color-border))',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        />
        <MiniMap
          position="bottom-right"
          nodeColor={(n) => n.data?.color || '#6B7280'}
          maskColor="rgba(0, 0, 0, 0.08)"
          style={{
            background: 'rgb(var(--color-surface))',
            border: '1px solid rgb(var(--color-border))',
            borderRadius: '12px',
          }}
        />
        <Background gap={20} size={1} color="rgb(var(--color-border) / 0.5)" />
      </ReactFlow>
    </div>
  );
}

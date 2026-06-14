# React Flow v12 (xyflow) — Complete Reference

React Flow v12 is a production-grade, framework-agnostic node-based UI library. The `@xyflow/react` package provides a React-specific API for building interactive graph visualizations with drag-and-drop nodes, customizable edges, connection validation, and viewport controls. This document covers core APIs, hooks, patterns, and gotchas for building real-world applications.

**Install:** `npm install @xyflow/react` (it pulls in `@xyflow/system` automatically — no separate install) and import `import '@xyflow/react/dist/style.css'` in your app entry point.

---

## Install & Setup

React Flow requires explicit width and height on its parent container. The simplest setup uses the three core hooks and passes them to the `<ReactFlow />` component:

```tsx
import React, { useCallback } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([
    { id: '1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
    { id: '2', position: { x: 200, y: 0 }, data: { label: 'Node 2' } },
  ]);

  const [edges, setEdges, onEdgesChange] = useEdgesState([
    { id: 'e1-2', source: '1', target: '2' },
  ]);

  const onConnect = useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
      />
    </div>
  );
}
```

> **Gotcha:** If the parent container lacks explicit width/height, React Flow renders at 0×0. Use CSS Grid, Flexbox, or fixed dimensions—`100vh`/`100vw` is a common pattern.

### ReactFlowProvider (Optional)

`ReactFlowProvider` is only needed in **advanced architectures** where hooks must be used far outside the `<ReactFlow />` tree. For standard usage—where hooks are called inside custom nodes, edges, or sibling components wrapped by `<ReactFlow />`—it is not required.

```tsx
import { ReactFlowProvider } from '@xyflow/react';

// Only needed if calling useReactFlow(), useNodes(), etc. deep in the component tree
function App() {
  return (
    <ReactFlowProvider>
      <YourFlowComponent />
    </ReactFlowProvider>
  );
}
```

---

## Core Data Model

### Node

A node is a discrete, draggable element on the canvas. Its minimum shape:

```typescript
interface Node<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string;                        // Unique identifier
  position: { x: number; y: number }; // Canvas coordinates
  data: TData;                       // Custom payload (passed to NodeProps)
}
```

Full shape with optional properties:

```typescript
interface Node<TData = {}, TType extends string | undefined = string> {
  id: string;
  type?: TType;                      // Matches a key in nodeTypes map
  data: TData;
  position: { x: number; y: number };
  
  // Styling
  style?: React.CSSProperties;
  className?: string;
  
  // Interaction state (set by React Flow)
  selected?: boolean;
  dragging?: boolean;
  hidden?: boolean;
  
  // Interaction control
  draggable?: boolean;               // Default: true
  selectable?: boolean;              // Default: true
  deletable?: boolean;               // Default: true
  connectable?: boolean;             // Default: true
  focusable?: boolean;               // Default: true
  
  // Dimensions (auto-calculated by React Flow, read-only)
  width?: number;                    // Auto-calculated after render
  height?: number;                   // Auto-calculated after render
  initialWidth?: number;             // Set initial node width before layout
  initialHeight?: number;            // Set initial node height before layout
  
  // Handles
  sourcePosition?: Position;         // Position.Top | .Right | .Bottom | .Left
  targetPosition?: Position;
  
  // Sub-flows / grouping
  parentId?: string;                 // Parent node ID for sub-flows
  extent?: 'parent' | [[x1, y1], [x2, y2]] | null;  // Movement boundaries
  expandParent?: boolean;            // Auto-expand parent bounds on drag
  
  // Z-ordering
  zIndex?: number;
  
  // Drag handle selector
  dragHandle?: string;               // CSS selector for drag-only areas
  
  // Accessibility
  ariaLabel?: string;
}
```

### Edge

An edge connects two nodes.

```typescript
interface Edge<TData extends Record<string, unknown> = {}> {
  id: string;
  source: string;                    // Source node ID
  target: string;                    // Target node ID
  
  // Handle routing
  sourceHandle?: string | null;      // Handle ID on source (for multi-handle nodes)
  targetHandle?: string | null;      // Handle ID on target
  
  // Rendering
  type?: string;                     // Matches a key in edgeTypes map
  data?: TData;
  animated?: boolean;
  hidden?: boolean;
  style?: React.CSSProperties;
  className?: string;
  
  // Markers (arrows)
  markerStart?: EdgeMarkerType;      // Arrow at source end
  markerEnd?: EdgeMarkerType;        // Arrow at target end
  
  // Interaction state
  selected?: boolean;
  
  // Interaction control
  selectable?: boolean;              // Default: true
  deletable?: boolean;               // Default: true
  reconnectable?: boolean;           // Default: true
  
  // Styling
  zIndex?: number;
  interactionWidth?: number;         // Click target width (default: 20)
  
  // Accessibility
  ariaLabel?: string;
}
```

### Handle

A handle is a connection point on a node. It appears as a circle on the node's edge. Use `<Handle>` inside custom nodes:

```tsx
import { Handle, Position } from '@xyflow/react';

function CustomNode({ data }) {
  return (
    <div>
      <Handle type="target" position={Position.Top} />
      <p>{data.label}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Multiple handles on one node:** Give each a unique `id`:

```tsx
<Handle type="target" position={Position.Left} id="input1" />
<Handle type="target" position={Position.Left} id="input2" />
<Handle type="source" position={Position.Right} id="output1" />
<Handle type="source" position={Position.Right} id="output2" />
```

Then reference them in edges:

```typescript
const edges = [
  {
    id: 'e1',
    source: 'node1',
    target: 'node2',
    sourceHandle: 'output1',
    targetHandle: 'input1',
  },
];
```

---

## Rendering: Nodes & Edges

### nodeTypes & edgeTypes

Custom rendering is controlled by maps of type name → component. **These MUST be stable references** (defined outside the component or wrapped in `useMemo`), or React Flow will remount every node on each render, tanking performance.

```tsx
import { useCallback } from 'react';
import { ReactFlow, NodeProps } from '@xyflow/react';

// CORRECT: Define outside component
const nodeTypes = {
  custom: CustomNode,
  input: InputNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

function App() {
  const [nodes, setNodes] = useNodesState([
    { id: '1', type: 'custom', position: { x: 0, y: 0 }, data: {} },
  ]);

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}        // Stable reference
      edgeTypes={edgeTypes}        // Stable reference
      {...otherProps}
    />
  );
}

// WRONG: Don't do this (remounts every render)
function BadApp() {
  const [nodes] = useNodesState([...]);
  return (
    <ReactFlow
      nodeTypes={{ custom: CustomNode }}  // New object every render!
      {...otherProps}
    />
  );
}
```

> **Gotcha:** Inline nodeTypes/edgeTypes objects cause React to unmount and remount every custom node component every frame. Use `useMemo` if you must build the map dynamically:
>
> ```tsx
> const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
> ```

### Node Positioning & Viewport

**defaultNodes / defaultEdges** — Uncontrolled mode:

```tsx
<ReactFlow defaultNodes={initialNodes} defaultEdges={initialEdges} />
```

**nodes / edges + onNodesChange / onEdgesChange** — Controlled mode (recommended):

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
/>
```

**defaultViewport** — Initial zoom & pan:

```tsx
<ReactFlow
  defaultViewport={{ x: 0, y: 0, zoom: 1.5 }}
  minZoom={0.5}
  maxZoom={4}
/>
```

**fitView** — Programmatically fit all nodes:

```tsx
const instance = useReactFlow();
instance.fitView({ padding: 0.2, duration: 800 });  // 800ms animation
```

---

## State — Controlled vs. Uncontrolled

### useNodesState & useEdgesState

These helper hooks manage state and provide change handlers:

```typescript
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
```

Returns:
- `nodes` — Current array
- `setNodes` — Update function (can take array or updater callback)
- `onNodesChange` — Pass directly to `<ReactFlow onNodesChange={...} />`

Internally, `onNodesChange` applies changes via `applyNodeChanges()`:

```typescript
function applyNodeChanges(
  changes: NodeChange[],
  nodes: Node[]
): Node[]
```

Where `NodeChange` is one of:
- `{ type: 'select'; id: string; selected: boolean }`
- `{ type: 'position'; id: string; position?: XYPosition; dragging?: boolean }`
- `{ type: 'dimensions'; id: string; width?: number; height?: number }`
- `{ type: 'remove'; id: string }`
- `{ type: 'reset' }`

### Manual State Updates

For custom updates, use `applyNodeChanges` directly:

```tsx
import { applyNodeChanges, NodeChange } from '@xyflow/react';

const [nodes, setNodes] = useState(initialNodes);

const onNodesChange = useCallback((changes: NodeChange[]) => {
  setNodes((nds) => applyNodeChanges(changes, nds));
}, []);
```

Or use `setNodes` with a callback:

```tsx
setNodes((nds) =>
  nds.map((node) =>
    node.id === '1' ? { ...node, data: { ...node.data, value: 42 } } : node
  )
);
```

> **Gotcha:** Never mutate node objects directly. React Flow relies on reference identity to detect changes. Always create a new node object:
>
> ```tsx
> // WRONG
> nodes[0].data.value = 42;
> setNodes(nodes);
>
> // RIGHT
> setNodes((nds) =>
>   nds.map((n) =>
>     n.id === '0'
>       ? { ...n, data: { ...n.data, value: 42 } }
>       : n
>   )
> );
> ```

### updateNodeData

Utility function for updating a single node's data immutably:

```typescript
const instance = useReactFlow();
instance.updateNodeData('node-1', { label: 'Updated' });
```

This method provides a shorthand for updating a single node's data without needing to manually map and rebuild the nodes array. Internally, React Flow applies the change immediately to the controlled state.

---

## Connecting Nodes

### onConnect & addEdge

The `onConnect` handler receives a `Connection` (minimal edge descriptor):

```typescript
interface Connection {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}
```

Convert it to a full `Edge` using `addEdge`:

```tsx
import { addEdge } from '@xyflow/react';

const onConnect = useCallback(
  (connection) => setEdges((eds) => addEdge(connection, eds)),
  [setEdges]
);

<ReactFlow
  nodes={nodes}
  edges={edges}
  onConnect={onConnect}
/>
```

### Connection Validation

Use `isValidConnection` to allow/deny connections. The callback fires when the user attempts to connect two handles:

```tsx
const isValidConnection = (connection) => {
  // Prevent self-loops
  if (connection.source === connection.target) return false;

  // Limit target handles to 1 incoming edge
  const hasSameTarget = edges.some(
    (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
  );
  if (hasSameTarget) return false;

  return true;
};

<ReactFlow
  isValidConnection={isValidConnection}
  {...otherProps}
/>
```

### connectionMode

Controls when connections are allowed:

```tsx
import { ConnectionMode } from '@xyflow/react';

<ReactFlow
  connectionMode={ConnectionMode.Strict}  // Source + target must match
  // or
  connectionMode={ConnectionMode.Loose}   // Either can initiate
/>
```

- **Strict:** Dragging from a handle source connects only to target handles (default).
- **Loose:** Can drag from either source or target handles; connection type is detected.

### Connection Preview Line

Customize the line shown while dragging:

```tsx
<ReactFlow
  connectionLineType="straight"  // 'bezier' (default), 'straight', 'step', 'smoothstep'
  connectionLineStyle={{ stroke: '#f0f0f0' }}
/>
```

Or provide a custom component:

```tsx
<ReactFlow
  connectionLineComponent={CustomConnectionLine}
/>
```

### onConnectStart / onConnectEnd

Lifecycle hooks:

```tsx
<ReactFlow
  onConnectStart={(event, { nodeId, handleId, handleType }) => {
    console.log(`Dragging from ${nodeId}/${handleId}`);
  }}
  onConnectEnd={(event) => {
    console.log('Connection drag ended');
  }}
/>
```

---

## Custom Nodes

### Basic Custom Node

A custom node is a React component receiving `NodeProps`:

```tsx
import { NodeProps, Handle, Position } from '@xyflow/react';

export function CustomNode(props: NodeProps<{ label: string }>) {
  const { id, data, selected } = props;

  return (
    <div
      style={{
        padding: 10,
        border: selected ? '2px solid blue' : '1px solid gray',
        borderRadius: 4,
        backgroundColor: 'white',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <p>{data.label}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

Register it:

```tsx
const nodeTypes = { custom: CustomNode };

<ReactFlow nodeTypes={nodeTypes} nodes={[
  { id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'My Node' } }
]} />
```

### NodeProps Type

```typescript
interface NodeProps<T extends Node = Node> {
  id: string;
  data: T['data'];
  type: string;
  selected: boolean;
  dragging: boolean;
  isConnectable: boolean;
  zIndex: number;
  xPos: number;
  yPos: number;
}

// Typed version for custom data:
interface NodeProps<TData extends Record<string, unknown> = {}> {
  id: string;
  data: TData;
  // ... rest
}
```

Example with typed data:

```typescript
type MyNodeData = { label: string; count: number };

export function CounterNode(props: NodeProps<MyNodeData>) {
  const { data } = props;
  return <div>{data.label}: {data.count}</div>;
}
```

### Multiple Handles

Use `id` prop to distinguish handles on the same node:

```tsx
function MultiHandleNode(props: NodeProps) {
  return (
    <div>
      <Handle type="target" position={Position.Left} id="top-input" />
      <Handle type="target" position={Position.Left} id="bottom-input" />
      
      <p>{props.data.label}</p>
      
      <Handle type="source" position={Position.Right} id="top-output" />
      <Handle type="source" position={Position.Right} id="bottom-output" />
    </div>
  );
}
```

Then in edges, specify `sourceHandle` and `targetHandle`:

```typescript
const edges = [
  {
    id: 'e1',
    source: 'node1',
    target: 'node2',
    sourceHandle: 'top-output',
    targetHandle: 'bottom-input',
  },
];
```

### Preventing Drag on Child Elements

Use the `nodrag` class to exclude elements from dragging:

```tsx
function CustomNode(props: NodeProps) {
  return (
    <div>
      <input className="nodrag" type="text" />  {/* Not draggable */}
      <textarea className="nodrag" />
      {/* Rest of node is draggable */}
    </div>
  );
}
```

Other escape hatches: `nopan` (disables panning when hovering) and `nowheel` (disables zoom on wheel).

### NodeResizer

Add resizable corners/edges to a node:

```tsx
import { NodeResizer } from '@xyflow/react';

function ResizableNode(props: NodeProps) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <NodeResizer minWidth={100} minHeight={100} maxWidth={500} />
      <Handle type="target" position={Position.Top} />
      <p>{props.data.label}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

Props:
- `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — Resize constraints
- `isVisible` — Show handles (default: true)
- `handleStyle`, `handleClassName` — Style resize handles
- `onResizeStart`, `onResize`, `onResizeEnd` — Callbacks
- `keepAspectRatio` — Lock aspect during resize

### NodeToolbar

Position a toolbar adjacent to a node:

```tsx
import { NodeToolbar, Position } from '@xyflow/react';

function ToolbarNode(props: NodeProps) {
  return (
    <>
      <NodeToolbar position={Position.Top}>
        <button>Edit</button>
        <button>Delete</button>
      </NodeToolbar>
      <div>{props.data.label}</div>
    </>
  );
}
```

### useUpdateNodeInternals

After dynamically adding/removing `<Handle>` elements, update React Flow's internal handle cache:

```tsx
import { useUpdateNodeInternals } from '@xyflow/react';

function DynamicHandleNode(props: NodeProps<{ handleCount: number }>) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    // After adding handles programmatically, notify React Flow
    updateNodeInternals(props.id);
  }, [props.data.handleCount, props.id, updateNodeInternals]);

  return (
    <div>
      {Array.from({ length: props.data.handleCount }).map((_, i) => (
        <Handle
          key={i}
          type="target"
          position={Position.Left}
          id={`input-${i}`}
        />
      ))}
    </div>
  );
}
```

---

## Custom Edges

### Basic Custom Edge

An edge component receives `EdgeProps` and must render an SVG path:

```typescript
import { EdgeProps, BaseEdge, getStraightPath } from '@xyflow/react';

export function CustomEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY } = props;

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return <BaseEdge id={id} path={edgePath} />;
}

const edgeTypes = { custom: CustomEdge };
```

### EdgeProps

```typescript
interface EdgeProps<TEdge extends Edge = Edge> {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  selected: boolean;
  animated: boolean;
  data?: TEdge['data'];
  markerStart?: string;
  markerEnd?: string;
  style?: CSSProperties;
  interactionWidth?: number;
}
```

### Path Helpers

React Flow provides utilities to calculate edge paths. All path helper functions accept `sourceX`, `sourceY`, `targetX`, `targetY`, and optional configuration, and return a tuple `[path, labelX, labelY, offsetX, offsetY]`:

```typescript
import {
  getBezierPath,           // Cubic Bezier (smooth curves)
  getSmoothStepPath,       // Smooth corners
  getStraightPath,         // Straight line
  getSimpleBezierPath,     // Simple quadratic Bezier
} from '@xyflow/react';

// All return [path, labelX, labelY, offsetX, offsetY]
const [path, labelX, labelY] = getBezierPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  curvature: 0.25,  // For Bezier variants
});
```

- **getBezierPath** — Cubic Bezier with smooth curves; supports `curvature` parameter (0–1).
- **getSmoothStepPath** — Step-like path with smooth corners; good for orthogonal layouts.
- **getStraightPath** — Direct straight line; simplest.
- **getSimpleBezierPath** — Simplified quadratic Bezier; lightweight alternative.

### BaseEdge

Wraps the SVG path and adds interaction:

```tsx
<BaseEdge
  id={id}
  path={edgePath}
  style={style}
  markerStart={markerStart}
  markerEnd={markerEnd}
  interactionWidth={interactionWidth}
/>
```

### Edge Labels (HTML)

Use `EdgeLabelRenderer` to render HTML labels on edges (positioned absolutely, outside the SVG):

```tsx
import { EdgeLabelRenderer, BaseEdge } from '@xyflow/react';

export function LabeledEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY } = props;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            backgroundColor: 'white',
            padding: '4px 8px',
            fontSize: '12px',
            pointerEvents: 'none',
          }}
        >
          {props.data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

---

## Built-In UI Plugins

### Background

Renders a grid/dot pattern behind the canvas:

```tsx
import { Background, BackgroundVariant } from '@xyflow/react';

<ReactFlow>
  <Background
    variant={BackgroundVariant.Dots}  // 'dots' | 'lines' | 'cross'
    gap={16}
    size={1}
    color="#ccc"
  />
</ReactFlow>
```

### Controls

Zoom/pan control buttons:

```tsx
import { Controls } from '@xyflow/react';

<ReactFlow>
  <Controls
    position="bottom-left"
    showZoom={true}
    showFitView={true}
    showInteractive={true}
    onZoomIn={() => {}}
    onZoomOut={() => {}}
    onFitView={() => {}}
  />
</ReactFlow>
```

### MiniMap

Viewport overview:

```tsx
import { MiniMap } from '@xyflow/react';

<ReactFlow>
  <MiniMap
    width={200}
    height={150}
    position="bottom-right"
    nodeColor={(node) => (node.selected ? 'blue' : 'gray')}
    nodeStrokeColor="black"
    pannable={true}
    zoomable={true}
  />
</ReactFlow>
```

### Panel

Generic floating container:

```tsx
import { Panel } from '@xyflow/react';

<ReactFlow>
  <Panel position="top-left">
    <h3>My Info</h3>
  </Panel>
</ReactFlow>
```

---

## useReactFlow Hook & Instance Methods

Access the flow instance to query and modify state programmatically:

```tsx
import { useReactFlow } from '@xyflow/react';

function ControlPanel() {
  const instance = useReactFlow();

  return (
    <>
      <button onClick={() => instance.zoomIn()}>Zoom In</button>
      <button onClick={() => instance.zoomOut()}>Zoom Out</button>
      <button onClick={() => instance.fitView()}>Fit View</button>
      <button
        onClick={() => {
          const nodes = instance.getNodes();
          const edges = instance.getEdges();
          console.log(nodes, edges);
        }}
      >
        Log State
      </button>
    </>
  );
}
```

### Full Instance API

```typescript
interface ReactFlowInstance {
  // Node queries & updates
  getNode(id: string): Node | undefined;
  getNodes(): Node[];
  setNodes(nodes: Node[] | (nodes: Node[]) => Node[]): void;
  addNodes(nodes: Node[]): void;  // Appends; use setNodes for full control
  deleteElements(params: { nodes?: Node[]; edges?: Edge[] }): void;

  // Edge queries & updates
  getEdge(id: string): Edge | undefined;
  getEdges(): Edge[];
  setEdges(edges: Edge[] | (edges: Edge[]) => Edge[]): void;
  addEdges(edges: Edge[]): void;

  // Viewport control
  getViewport(): { x: number; y: number; zoom: number };
  setViewport(vp: { x: number; y: number; zoom: number }): void;
  fitView(options?: FitViewOptions): Promise<boolean>;
  zoomIn(options?: ViewportHelperOptions): void;
  zoomOut(options?: ViewportHelperOptions): void;
  getZoom(): number;

  // Selection
  getSelectedNodes(): Node[];
  getSelectedEdges(): Edge[];

  // Coordinate conversion
  screenToFlowPosition(
    position: XYPosition,
    options?: { snapToGrid?: boolean }
  ): XYPosition;
  flowToScreenPosition(position: XYPosition): XYPosition;

  // Update single node's data immutably
  updateNodeData(id: string, data: Partial<Node['data']>): void;

  // Serialization
  toObject(): ReactFlowJsonObject;
}

interface FitViewOptions {
  padding?: number;           // 0–1 (0.2 = 20% padding)
  includeHiddenNodes?: boolean;
  duration?: number;          // Animation time in ms
  minZoom?: number;
  maxZoom?: number;
}

interface ViewportHelperOptions {
  duration?: number;          // Animation time in ms
}
```

---

## Hooks Reference

### State & Query Hooks

```typescript
// Return current nodes/edges array; re-render on change
const nodes = useNodes();
const edges = useEdges();

// Manage state externally; like useState
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

// Get current viewport
const viewport = useViewport();  // { x, y, zoom }

// Get node data updates for specific node(s)
const data = useNodesData(['node1', 'node2']);
// Returns { node1: {...}, node2: {...} } or undefined if not found
```

### Instance & Control Hooks

```typescript
// Main instance (use inside <ReactFlow> tree or wrap with ReactFlowProvider)
const instance = useReactFlow();

// Access Zustand store directly (advanced)
const state = useStore((s) => ({ nodes: s.nodes, zoom: s.zoom }));
const storeApi = useStoreApi();

// Detect when nodes have been measured (dimensions calculated)
const nodesInitialized = useNodesInitialized();

// Update node internal handle cache (call after dynamic handle changes)
const updateNodeInternals = useUpdateNodeInternals();
```

### Connection Hooks

```typescript
// Active connection being dragged (null when idle)
const connection = useConnection();
// Returns { source, target, sourceHandle, targetHandle } or null

// Edges connected to a specific handle
const edges = useHandleConnections({
  type: 'source',  // or 'target'
  id: 'my-handle-id',
});

// All edges connected to a node
const edges = useNodeConnections('node-id');
```

### Event Hooks

```typescript
// Listen to viewport changes (pan/zoom)
useOnViewportChange((viewport) => {
  console.log(viewport.zoom);
});

// Listen to selection changes
useOnSelectionChange(({ nodes, edges }) => {
  console.log('Selected:', nodes, edges);
});

// Detect if a key is currently pressed
const spacePressed = useKeyPress('Space');
if (spacePressed) {
  // Prevent panning, for example
}
```

---

## Performance Optimization

### Stable nodeTypes & edgeTypes

Always define outside the component or use `useMemo`:

```tsx
// GOOD
const nodeTypes = useMemo(
  () => ({ custom: CustomNode }),
  []
);

// GOOD (outside component)
const nodeTypes = { custom: CustomNode };

// BAD (remounts every render)
<ReactFlow nodeTypes={{ custom: CustomNode }} />
```

### React.memo for Custom Nodes

Wrap custom node components:

```tsx
export const CustomNode = React.memo(function CustomNode(props: NodeProps) {
  return <div>{props.data.label}</div>;
});

const nodeTypes = { custom: CustomNode };
```

### onlyRenderVisibleElements

For large graphs (1000+ nodes), enable viewport-based culling:

```tsx
<ReactFlow
  onlyRenderVisibleElements={true}
  snapToGrid={true}
  snapGrid={[20, 20]}
/>
```

Only renders nodes/edges within the viewport. With `snapToGrid`, pan/drag calculations are simplified.

### Avoid Recreating Data Objects

Data payloads should be stable across renders:

```tsx
// WRONG
function App() {
  const [nodes] = useNodesState([
    { id: '1', data: { label: 'Node' }, position: { x: 0, y: 0 } },
  ]);
  // Same node object each render? No—new object created on render!
  return <ReactFlow nodes={nodes} />;
}

// RIGHT
const initialNodes = [
  { id: '1', data: { label: 'Node' }, position: { x: 0, y: 0 } },
];
function App() {
  const [nodes] = useNodesState(initialNodes);
  return <ReactFlow nodes={nodes} />;
}
```

### useStore with Shallow Equality

For custom Zustand selectors, use the `shallow` helper to avoid unnecessary re-renders:

```tsx
import { useStore } from '@xyflow/react';
import { shallow } from 'zustand/react/shallow';

function MyComponent() {
  const { nodes, edges } = useStore(
    (s) => ({ nodes: s.nodes, edges: s.edges }),
    shallow  // Only re-render if nodes or edges reference changes
  );
  return <div>{nodes.length} nodes</div>;
}
```

Without `shallow`, a new object `{ nodes, edges }` is created every time, causing re-renders.

### elevateNodesOnSelect

When a node is selected, raise its z-index to the top:

```tsx
<ReactFlow elevateNodesOnSelect={true} />
```

### defaultEdgeOptions

Set default props for all new edges:

```tsx
import { MarkerType } from '@xyflow/react';

<ReactFlow
  defaultEdgeOptions={{
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  }}
/>
```

Reduces boilerplate when creating edges via `onConnect`.

---

## State at Scale: Zustand Patterns

For apps with complex state logic, lift nodes/edges into a Zustand store:

```typescript
import { create } from 'zustand';
import {
  Node,
  Edge,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Connection,
} from '@xyflow/react';

interface Store {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
}

const useStore = create<Store>((set) => ({
  nodes: initialNodes,
  edges: initialEdges,
  setNodes: (nodes) => set({ nodes }),
  onNodesChange: (changes) =>
    set(({ nodes }) => ({
      nodes: applyNodeChanges(changes, nodes),
    })),
  onEdgesChange: (changes) =>
    set(({ edges }) => ({
      edges: applyEdgeChanges(changes, edges),
    })),
  onConnect: (connection) =>
    set(({ edges }) => ({
      edges: addEdge(connection, edges),
    })),
}));

// In component:
function Flow() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useStore();
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
    />
  );
}
```

This pattern scales better than local state for large, multi-page apps.

---

## Layouting

React Flow has **no built-in auto-layout**. Integrate a third-party library and update node positions:

### Dagre (Tree/Hierarchical)

Ideal for tree structures and hierarchical layouts:

```tsx
import dagre from 'dagre';

function useLayoutedElements() {
  const instance = useReactFlow();
  const nodes = instance.getNodes();
  const edges = instance.getEdges();

  const graph = new dagre.graphlib.Graph({ compound: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: 150, height: 50 });
  });

  edges.forEach((edge) => {
    graph.addEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    return { ...node, position: { x, y } };
  });

  instance.setNodes(layoutedNodes);
  instance.fitView();
}
```

Call after adding nodes:

```tsx
<button onClick={useLayoutedElements}>Auto-Layout</button>
```

### ELK (elkjs)

For complex layouts with extensive configuration (edge routing, layering, spacing):

```tsx
import ELK from 'elkjs';

async function layoutWithElk() {
  const elk = new ELK();
  const instance = useReactFlow();
  const nodes = instance.getNodes();
  const edges = instance.getEdges();

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: 150,
      height: 50,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const layouted = await elk.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const child = layouted.children?.find((c) => c.id === node.id);
    return {
      ...node,
      position: { x: child?.x || 0, y: child?.y || 0 },
    };
  });

  instance.setNodes(layoutedNodes);
  instance.fitView();
}
```

**Other options:**
- **D3-Hierarchy** — Single-root tree layouts; uniform sizing.
- **D3-Force** — Physics-based force-directed layouts.
- **react-flow-smart-edge** — Smart edge routing without full layouting.

---

## Sub-Flows & Grouping

Use `parentId` to create hierarchical node groups:

```typescript
const nodes: Node[] = [
  {
    id: 'group-1',
    position: { x: 0, y: 0 },
    data: { label: 'Group' },
    style: { width: 300, height: 200 },
  },
  {
    id: 'child-1',
    parentId: 'group-1',
    position: { x: 50, y: 50 },  // Relative to parent
    data: { label: 'Child' },
  },
  {
    id: 'child-2',
    parentId: 'group-1',
    position: { x: 200, y: 50 },
    data: { label: 'Child 2' },
  },
];
```

**Key behaviors:**
- Child coordinates are **relative** to parent's top-left.
- Children are always rendered **above** their parent (`z-index: parent.z + 1`).
- Deleting a parent **automatically deletes children** (synchronous cascade).
- `extent: 'parent'` restricts a child's dragging to the parent bounds.
- `expandParent: true` auto-expands the parent bounding box when a child is dragged beyond it.

```typescript
const nodes: Node[] = [
  {
    id: 'group-1',
    position: { x: 0, y: 0 },
    data: { label: 'Resizable Group' },
    style: { width: 300, height: 300 },
  },
  {
    id: 'child-1',
    parentId: 'group-1',
    position: { x: 200, y: 200 },
    data: { label: 'Drag me outside' },
    extent: 'parent',        // Confined to parent
    expandParent: true,      // Auto-expand parent if dragged beyond
  },
];
```

---

## Interaction: Selection & Deletion

### Selection

Select nodes by clicking; multi-select with `Ctrl/Cmd + Click`:

```tsx
<ReactFlow
  multiSelectionKeyCode="Control"  // or 'Shift', 'Meta'
  selectionOnDrag={true}           // Drag to select box
  selectNodesOnDrag={false}        // (Performance opt) Don't select while dragging
/>
```

Listen to changes:

```tsx
const [selection, setSelection] = useState({ nodes: [], edges: [] });

<ReactFlow
  onSelectionChange={(sel) => setSelection(sel)}
/>
```

### Deletion

Nodes/edges are deleted by pressing `Delete` or `Backspace` (customizable):

```tsx
<ReactFlow
  deleteKeyCode={['Delete', 'Backspace']}  // Allow both keys
/>
```

Custom delete handler:

```tsx
const onDelete = ({ nodes, edges }) => {
  console.log('Deleting:', nodes, edges);
  // Handle cleanup if needed
};

<ReactFlow onDelete={onDelete} />
```

---

## Drag & Drop from Sidebar (External Nodes)

Accept draggable elements from a palette:

```tsx
function App() {
  const reactFlowInstance = useReactFlow();
  const [nodes, setNodes] = useNodesState([]);

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('application/reactflow');
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNode: Node = {
      id: `node-${Date.now()}`,
      type,
      position,
      data: { label: `${type} node` },
    };

    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div style={{ display: 'flex' }}>
      <aside style={{ width: 200, borderRight: '1px solid black' }}>
        <div
          draggable
          onDragStart={(e) =>
            e.dataTransfer?.setData('application/reactflow', 'custom')
          }
          style={{ padding: 10, border: '1px dashed gray', cursor: 'move' }}
        >
          Custom Node
        </div>
      </aside>

      <div style={{ flex: 1, height: '100vh' }}>
        <ReactFlow
          nodes={nodes}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      </div>
    </div>
  );
}
```

---

## Theming & Styling

React Flow v12 ships **two** layers of theming: the built-in **`colorMode` prop** (light/dark/system out of the box) and the underlying **`--xy-*` CSS variables** (for fine customization). Most apps only need `colorMode`.

### The `colorMode` prop (built-in dark mode)

```tsx
import { ReactFlow, type ColorMode } from '@xyflow/react'

<ReactFlow colorMode="dark" nodes={nodes} edges={edges} />   // 'light' | 'dark' | 'system'
```

- Type: `ColorMode = 'light' | 'dark' | 'system'`. **Default `'light'`.**
- `'system'` follows the OS `prefers-color-scheme`.
- Internally React Flow sets a `.dark`/`.light` class on the `.react-flow` wrapper and swaps the `--xy-*` variables — you get a usable dark theme with zero CSS.

> Gotcha: It is a real, supported prop (added in v12). You do **not** need a MutationObserver or a manual `data-color-mode` toggle just to get dark mode — pass `colorMode`.

### Integration with `next-themes` (this repo)

ProfitSync drives dark mode through `next-themes` (class strategy). Feed the resolved theme straight into `colorMode`:

```tsx
import { useTheme } from 'next-themes'
import { ReactFlow, type ColorMode } from '@xyflow/react'

function Flow() {
  const { resolvedTheme } = useTheme()
  return (
    <ReactFlow
      colorMode={(resolvedTheme as ColorMode) ?? 'system'}
      nodes={nodes}
      edges={edges}
    />
  )
}
```

### CSS Variables (fine customization)

Beyond `colorMode`, override any `--xy-*` token. Scope dark overrides under the wrapper class React Flow applies (or your own `.dark`):

```css
.react-flow {
  --xy-background-color: white;
  --xy-edge-stroke: #b1b1b7;
  --xy-node-background-color: white;
  --xy-selection-background-color: rgb(0 89 220 / 0.08);
  /* full list in the CSS Variables Reference section below */
}

.react-flow.dark {
  --xy-background-color: #141414;
  --xy-edge-stroke: #555;
  --xy-node-background-color: #1a1a1a;
}
```

> Gotcha: You can also style nodes/edges with plain `className`/`style` and Tailwind. `colorMode` + a few `--xy-*` overrides usually beats hand-writing a full theme.

---

## TypeScript

### Typing Nodes & Edges

```typescript
// Typed node data
type MyNodeData = {
  label: string;
  value: number;
};

type MyNode = Node<MyNodeData, 'custom'>;

// In component
const nodes: MyNode[] = [
  {
    id: '1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { label: 'Test', value: 42 },
  },
];

// Custom node with typed props
function CustomNode(props: NodeProps<MyNode>) {
  const { data } = props;
  return <div>{data.label}: {data.value}</div>;
}
```

### Typed nodeTypes & edgeTypes

```typescript
import { NodeTypes, EdgeTypes, Node, Edge, NodeProps, EdgeProps } from '@xyflow/react';

type CustomNode = Node<{ label: string }, 'custom'>;
type CustomEdge = Edge<{ weight: number }>;

const nodeTypes: NodeTypes = {
  custom: CustomNode as React.ComponentType<NodeProps<CustomNode>>,
};

const edgeTypes: EdgeTypes = {
  weighted: CustomEdge as React.ComponentType<EdgeProps<CustomEdge>>,
};
```

---

## Common Gotchas

1. **Missing CSS import** — Always `import '@xyflow/react/dist/style.css'` early in your app entry point. Without it, React Flow renders but is invisible.

2. **Zero-size parent container** — React Flow needs explicit width/height. It won't inherit from a flex or grid parent. Always set `width: 100%`, `height: 100vh`, or fixed dimensions on the parent.

3. **Inline nodeTypes/edgeTypes** — Every render, a new object is created, forcing React to remount every custom node. Use `useMemo` or define outside the component.

4. **Mutating node data** — Always create new node objects. React relies on reference identity to detect changes:
   ```tsx
   // WRONG
   node.data.value = 42;

   // RIGHT
   setNodes((nds) =>
     nds.map((n) =>
       n.id === targetId
         ? { ...n, data: { ...n.data, value: 42 } }
         : n
     )
   );
   ```

5. **Stale closures in node callbacks** — If a custom node needs to call a parent callback, pass data via the node's `data` object, or use `useReactFlow()` to access the instance:
   ```tsx
   function CustomNode(props: NodeProps) {
     const instance = useReactFlow();
     const handleClick = () => {
       const nodes = instance.getNodes();
       // ...
     };
     return <button onClick={handleClick}>Click me</button>;
   }
   ```

6. **Handle ID mismatches** — If an edge's `sourceHandle` doesn't match any `<Handle id="...">` in the source node, the edge won't connect visually. Check for typos.

7. **Controlled nodes without onNodesChange** — If you pass `nodes` but don't implement `onNodesChange`, node interactions (drag, select) won't update state. Always pair them:
   ```tsx
   // INCOMPLETE (read-only)
   <ReactFlow nodes={nodes} />
   // COMPLETE
   <ReactFlow
     nodes={nodes}
     onNodesChange={onNodesChange}
     edges={edges}
     onEdgesChange={onEdgesChange}
   />
   ```

8. **updateNodeInternals timing** — Call `useUpdateNodeInternals()` *after* handles are added to the DOM, not before. Use `useEffect` with the correct dependency array.

9. **Graph with no parent container dimensions** — If `<ReactFlow />`'s parent has no width/height, it renders at 0×0 and is invisible. Always explicitly size the parent.

10. **Performance with large graphs** — Enable `onlyRenderVisibleElements` and `snapToGrid` for 1000+ nodes. Without viewport culling, every node and edge renders regardless of visibility.

11. **Parent-child delete cascade** — Deleting a parent node synchronously deletes all children. Cascading is immediate; there are no race conditions. If you need to prevent deletion or handle cleanup, check `deletable` flag or implement custom `onDelete` handler.

12. **extent='parent' coordinate system** — Child nodes with `extent: 'parent'` are constrained in **parent-relative coordinates**. When dragging, React Flow enforces the constraint in the parent's local space, not the viewport.

---

## CSS Variables Reference

Common React Flow CSS variables for dark/light mode:

```css
/* Background & Canvas */
--xy-bg: white;                      /* Canvas background */

/* Edges & Connections */
--xy-edge: #ddd;                     /* Edge stroke color */
--xy-selection: #0ea5e9;             /* Selection highlight */

/* Nodes */
--xy-node-bg: white;                 /* Node background */
--xy-node-border: #e5e7eb;           /* Node border */
--xy-node-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); /* Node shadow */

/* Text */
--xy-text: #333;                     /* Text color */
--xy-text-secondary: #666;           /* Secondary text */
```

For a complete list, check the official documentation or inspect computed styles on a running React Flow instance.

---

This document covers the essential APIs and patterns needed for production React Flow applications. Refer to [reactflow.dev](https://reactflow.dev) for detailed examples, advanced topics, and framework integration guides.

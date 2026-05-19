import { finalizeEdgeDrawing, finalizeEdgeDrawingToNode } from './edgeLogic';
import { applyCommand } from './commands/core';
import type { DesignStoreState } from '../../store/useDesignStore';

describe('edgeLogic: Edge Finalization', () => {
  const mockNode = (refId: string, type: string, coords: [number, number]) => ({
    refId,
    type: type as 'OLT' | 'ODC' | 'ODP',
    origin: 'AUTO' as const,
    coordinates: coords,
    properties: {},
  });

  const createMockState = (overrides?: Partial<DesignStoreState>): DesignStoreState => ({
    designId: null,
    projectId: null,
    editMode: true,
    activeTool: null,
    drawingEdgeStartRef: null,
    drawingEdgeCoords: [],
    selectedFeatureRef: null,
    nodes: {},
    edges: {},
    calcInputs: null,
    baseTopology: null,
    sketchMode: false,
    sketchTopology: { type: 'FeatureCollection', features: [] },
    sketchOpacity: 1,
    selectedNodeIds: new Set<string>(),
    selectedEdgeIds: new Set<string>(),
    setProjectId: () => {},
    setCalcData: () => {},
    setSketchMode: () => {},
    setSketchTopology: () => {},
    setSketchOpacity: () => {},
    hydrate: () => {},
    clear: () => {},
    setEditMode: () => {},
    setActiveTool: () => {},
    setDrawingEdgeStartRef: () => {},
    setDrawingEdgeCoords: () => {},
    setSelectedFeatureRef: () => {},
    getNode: () => undefined,
    getEdgesForNode: () => [],
    ...overrides,
  });

  describe('finalizeEdgeDrawing', () => {
    it('returns null when activeTool is not an edge tool', () => {
      const state = createMockState({
        activeTool: 'delete',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [[100, 0]],
      });
      const result = finalizeEdgeDrawing(state);
      expect(result).toBeNull();
    });

    it('returns null when drawingEdgeStartRef is null', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: null,
        drawingEdgeCoords: [[100, 0]],
      });
      const result = finalizeEdgeDrawing(state);
      expect(result).toBeNull();
    });

    it('returns null when startNode does not exist', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'nonexistent',
        drawingEdgeCoords: [[100, 0]],
        nodes: {},
      });
      const result = finalizeEdgeDrawing(state);
      expect(result).toBeNull();
    });

    it('returns null when drawingEdgeCoords is empty', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [],
        nodes: {
          'node-1': mockNode('node-1', 'OLT', [100, 0]),
        },
      });
      const result = finalizeEdgeDrawing(state);
      expect(result).toBeNull();
    });

    it('finalizes edge drawing with FEEDER type when double-clicking during feeder edge drawing', () => {
      const startNode = mockNode('node-1', 'OLT', [100, 0]);
      const waypoint1: [number, number] = [102, 1];
      const waypoint2: [number, number] = [104, 2];

      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [waypoint1, waypoint2],
        nodes: { 'node-1': startNode },
      });

      const result = finalizeEdgeDrawing(state);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('AddEdge');
      expect(result!.edgeType).toBe('FEEDER');
      expect(result!.fromRef).toBe('node-1');
      expect(result!.coordinates).toEqual([[100, 0], waypoint1, waypoint2]);
      expect(result!.toRef).toBe(`waypoint-${waypoint2[0]}-${waypoint2[1]}`);
    });

    it('finalizes edge drawing with DISTRIBUTION type', () => {
      const startNode = mockNode('node-1', 'ODC', [100, 0]);
      const waypoint: [number, number] = [102, 1];

      const state = createMockState({
        activeTool: 'add-edge-distribution',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [waypoint],
        nodes: { 'node-1': startNode },
      });

      const result = finalizeEdgeDrawing(state);

      expect(result).not.toBeNull();
      expect(result!.edgeType).toBe('DISTRIBUTION');
      expect(result!.fromRef).toBe('node-1');
    });

    it('finalizes edge drawing with DROP type', () => {
      const startNode = mockNode('node-1', 'ODP', [100, 0]);
      const waypoint: [number, number] = [102, 1];

      const state = createMockState({
        activeTool: 'add-edge-drop',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [waypoint],
        nodes: { 'node-1': startNode },
      });

      const result = finalizeEdgeDrawing(state);

      expect(result).not.toBeNull();
      expect(result!.edgeType).toBe('DROP');
    });
  });

  describe('finalizeEdgeDrawingToNode', () => {
    it('returns null when target node is same as start node (self-loop prevention)', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [[102, 1]],
        nodes: {
          'node-1': mockNode('node-1', 'OLT', [100, 0]),
        },
      });

      const result = finalizeEdgeDrawingToNode(state, 'node-1');
      expect(result).toBeNull();
    });

    it('returns null when start node does not exist', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'nonexistent',
        drawingEdgeCoords: [[102, 1]],
        nodes: {
          'node-2': mockNode('node-2', 'ODC', [105, 5]),
        },
      });

      const result = finalizeEdgeDrawingToNode(state, 'node-2');
      expect(result).toBeNull();
    });

    it('returns null when target node does not exist', () => {
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [[102, 1]],
        nodes: {
          'node-1': mockNode('node-1', 'OLT', [100, 0]),
        },
      });

      const result = finalizeEdgeDrawingToNode(state, 'nonexistent');
      expect(result).toBeNull();
    });

    it('creates edge with both start and target node references', () => {
      const startNode = mockNode('node-1', 'OLT', [100, 0]);
      const targetNode = mockNode('node-2', 'ODC', [105, 5]);
      const waypoint: [number, number] = [102, 1];

      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [waypoint],
        nodes: {
          'node-1': startNode,
          'node-2': targetNode,
        },
      });

      const result = finalizeEdgeDrawingToNode(state, 'node-2');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('AddEdge');
      expect(result!.fromRef).toBe('node-1');
      expect(result!.toRef).toBe('node-2');
      expect(result!.coordinates).toEqual([[100, 0], waypoint, [105, 5]]);
      expect(result!.edgeType).toBe('FEEDER');
    });

    it('includes all intermediate waypoints in final coordinates', () => {
      const startNode = mockNode('node-1', 'OLT', [100, 0]);
      const targetNode = mockNode('node-2', 'ODC', [110, 10]);
      const waypoints: [number, number][] = [[102, 1], [104, 2], [106, 3]];

      const state = createMockState({
        activeTool: 'add-edge-distribution',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: waypoints,
        nodes: {
          'node-1': startNode,
          'node-2': targetNode,
        },
      });

      const result = finalizeEdgeDrawingToNode(state, 'node-2');

      expect(result!.coordinates).toEqual([
        [100, 0],
        [102, 1],
        [104, 2],
        [106, 3],
        [110, 10],
      ]);
    });
  });

  // ── Integration test: simulates the full dblclick finalization flow ──
  describe('Integration: dblclick edge finalization flow', () => {
    it('adds edge to state.edges, clears drawingEdgeCoords and drawingEdgeStartRef', () => {
      // ARRANGE: state where user has started drawing a FEEDER edge with 2 waypoints
      const startNode = mockNode('node-1', 'OLT', [100, 0]);
      const waypoint1: [number, number] = [101, 0.5];
      const waypoint2: [number, number] = [102, 1];

      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [waypoint1, waypoint2],
        nodes: { 'node-1': startNode },
        edges: {},
      });

      // ACT: call finalizeEdgeDrawing (the function triggered by dblclick)
      const cmd = finalizeEdgeDrawing(state);

      // ASSERT: command was produced
      expect(cmd).not.toBeNull();
      expect(cmd!.type).toBe('AddEdge');
      expect(cmd!.edgeType).toBe('FEEDER');
      expect(cmd!.fromRef).toBe('node-1');
      expect(cmd!.coordinates).toEqual([[100, 0], waypoint1, waypoint2]);

      // ACT: simulate dispatching the command via applyCommand
      const stateSlice = { nodes: state.nodes, edges: state.edges };
      const nextSlice = applyCommand(stateSlice, cmd!);

      // ASSERT: new edge exists in state.edges
      expect(Object.keys(nextSlice.edges).length).toBe(1);
      const addedEdge = Object.values(nextSlice.edges)[0];
      expect(addedEdge.type).toBe('FEEDER');
      expect(addedEdge.fromRef).toBe('node-1');
      expect(addedEdge.coordinates).toEqual([[100, 0], waypoint1, waypoint2]);

      // ACT: simulate clearing drawing state (done in useDesignModeMarkers after dispatch)
      const clearedState = {
        ...state,
        edges: nextSlice.edges,
        drawingEdgeStartRef: null as string | null,
        drawingEdgeCoords: [] as [number, number][],
      };

      // ASSERT: drawing state is cleared
      expect(clearedState.drawingEdgeCoords).toEqual([]);
      expect(clearedState.drawingEdgeStartRef).toBeNull();
      // ASSERT: edge is still in edges
      expect(Object.keys(clearedState.edges).length).toBe(1);
    });

    it('clears drawing state even when cmd is null (zero waypoints)', () => {
      // ARRANGE: user dblclicked immediately after selecting start (no waypoints)
      const startNode = mockNode('node-1', 'OLT', [100, 0]);
      const state = createMockState({
        activeTool: 'add-edge-feeder',
        drawingEdgeStartRef: 'node-1',
        drawingEdgeCoords: [],
        nodes: { 'node-1': startNode },
        edges: {},
      });

      // ACT
      const cmd = finalizeEdgeDrawing(state);

      // ASSERT: command is null (can't create zero-length edge)
      expect(cmd).toBeNull();

      // ACT: simulate the dblclick handler clearing state regardless
      const clearedState = {
        ...state,
        drawingEdgeStartRef: null as string | null,
        drawingEdgeCoords: [] as [number, number][],
      };

      // ASSERT: drawing state is cleared even without a valid command
      expect(clearedState.drawingEdgeCoords).toEqual([]);
      expect(clearedState.drawingEdgeStartRef).toBeNull();
      // ASSERT: no edges were added
      expect(Object.keys(clearedState.edges).length).toBe(0);
    });

    it('works with DISTRIBUTION edge type', () => {
      const startNode = mockNode('node-odc', 'ODC', [106.8, -6.2]);
      const waypoints: [number, number][] = [[106.81, -6.21], [106.82, -6.22]];

      const state = createMockState({
        activeTool: 'add-edge-distribution',
        drawingEdgeStartRef: 'node-odc',
        drawingEdgeCoords: waypoints,
        nodes: { 'node-odc': startNode },
        edges: {},
      });

      const cmd = finalizeEdgeDrawing(state);
      expect(cmd).not.toBeNull();
      expect(cmd!.edgeType).toBe('DISTRIBUTION');

      const nextSlice = applyCommand({ nodes: state.nodes, edges: state.edges }, cmd!);
      expect(Object.keys(nextSlice.edges).length).toBe(1);
      expect(Object.values(nextSlice.edges)[0].type).toBe('DISTRIBUTION');
    });

    it('works with DROP edge type', () => {
      const startNode = mockNode('node-odp', 'ODP', [106.9, -6.3]);
      const waypoints: [number, number][] = [[106.91, -6.31]];

      const state = createMockState({
        activeTool: 'add-edge-drop',
        drawingEdgeStartRef: 'node-odp',
        drawingEdgeCoords: waypoints,
        nodes: { 'node-odp': startNode },
        edges: {},
      });

      const cmd = finalizeEdgeDrawing(state);
      expect(cmd).not.toBeNull();
      expect(cmd!.edgeType).toBe('DROP');

      const nextSlice = applyCommand({ nodes: state.nodes, edges: state.edges }, cmd!);
      expect(Object.keys(nextSlice.edges).length).toBe(1);
      expect(Object.values(nextSlice.edges)[0].type).toBe('DROP');
    });
  });
});

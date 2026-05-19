import type { AddEdgeCommand } from './commands/types';
import type { DesignStoreState } from '../../store/useDesignStore';

/**
 * Attempts to finalize edge drawing by double-clicking when an edge tool is active.
 * Returns the new edge command to dispatch, or null if finalization is not possible.
 * 
 * **Preconditions:**
 * - `activeTool` must be one of the edge tools: 'add-edge-feeder', 'add-edge-distribution', 'add-edge-drop'
 * - `drawingEdgeStartRef` must reference a valid node
 * - `drawingEdgeCoords` must have at least 1 waypoint (for non-degenerate edge) OR 0 for direct connection
 */
export function finalizeEdgeDrawing(state: DesignStoreState): AddEdgeCommand | null {
  const { activeTool, drawingEdgeStartRef, drawingEdgeCoords, nodes } = state;

  // Validate preconditions
  if (!activeTool || !activeTool.startsWith('add-edge-')) {
    return null;
  }

  if (!drawingEdgeStartRef) {
    return null;
  }

  const startNode = nodes[drawingEdgeStartRef];
  if (!startNode) {
    return null;
  }

  // Extract edge type from tool name (e.g., 'add-edge-feeder' → 'FEEDER')
  const edgeTypeRaw = activeTool.split('add-edge-')[1]?.toUpperCase();
  if (!edgeTypeRaw) {
    return null;
  }

  const edgeType = edgeTypeRaw as 'FEEDER' | 'DISTRIBUTION' | 'DROP';

  // For double-click to finalize: we need to create an edge that loops back to the start node
  // OR continues in the same sequence. Since there's no explicit second node selected on double-click,
  // we finalize with the last coordinate as the terminus (which is the mouse position from mousemove).
  // However, the user likely intends to END the edge at its current ghost position.
  
  // Edge case: if drawingEdgeCoords is empty, user double-clicked immediately after selecting start node.
  // In this case, we cannot create a valid edge (would be zero-length).
  if (drawingEdgeCoords.length === 0) {
    return null;
  }

  // The last coordinate in drawingEdgeCoords is the current end position (from mousemove).
  const coordinates: [number, number][] = [
    [startNode.coordinates[0], startNode.coordinates[1]],
    ...drawingEdgeCoords,
  ];

  // For double-click finalization, we use the LAST coordinate as the terminus node reference.
  // In practice, this is a special "temporary end node" refId. For now, we'll use a synthetic ID.
  const lastCoord = drawingEdgeCoords[drawingEdgeCoords.length - 1];
  const toRef = `waypoint-${lastCoord[0]}-${lastCoord[1]}`;

  const cmd: AddEdgeCommand = {
    type: 'AddEdge',
    refId: `edge-${Date.now()}`,
    fromRef: startNode.refId,
    toRef, // This is a synthetic ref for the terminus waypoint
    edgeType,
    coordinates,
  };

  return cmd;
}

/**
 * Test helper: creates a finalized edge with explicit coordinates and node references.
 * Used when double-click has selected two actual nodes instead of just a waypoint.
 */
export function finalizeEdgeDrawingToNode(
  state: DesignStoreState,
  targetNodeRefId: string
): AddEdgeCommand | null {
  const { activeTool, drawingEdgeStartRef, drawingEdgeCoords, nodes } = state;

  if (!activeTool || !activeTool.startsWith('add-edge-')) {
    return null;
  }

  if (!drawingEdgeStartRef || drawingEdgeStartRef === targetNodeRefId) {
    return null;
  }

  const startNode = nodes[drawingEdgeStartRef];
  const targetNode = nodes[targetNodeRefId];

  if (!startNode || !targetNode) {
    return null;
  }

  const edgeTypeRaw = activeTool.split('add-edge-')[1]?.toUpperCase();
  if (!edgeTypeRaw) {
    return null;
  }

  const edgeType = edgeTypeRaw as 'FEEDER' | 'DISTRIBUTION' | 'DROP';

  const coordinates: [number, number][] = [
    [startNode.coordinates[0], startNode.coordinates[1]],
    ...drawingEdgeCoords,
    [targetNode.coordinates[0], targetNode.coordinates[1]],
  ];

  const cmd: AddEdgeCommand = {
    type: 'AddEdge',
    refId: `edge-${Date.now()}`,
    fromRef: startNode.refId,
    toRef: targetNode.refId,
    edgeType,
    coordinates,
  };

  return cmd;
}

import type { CommandStateSlice, Coordinates2D, MoveNodeCommand } from './types';

function patchEdgesForNode(
  edges: CommandStateSlice['edges'],
  refId: string,
  nextCoords: Coordinates2D,
): CommandStateSlice['edges'] {
  const nextEdges: CommandStateSlice['edges'] = { ...edges };

  for (const edgeRefId of Object.keys(edges)) {
    const edge = edges[edgeRefId];
    if (!edge) continue;
    if (edge.fromRef !== refId && edge.toRef !== refId) continue;
    if (edge.coordinates.length < 2) continue;

    const nextCoordinates = edge.coordinates.map(
      (coord): Coordinates2D => [coord[0], coord[1]],
    );
    if (edge.fromRef === refId) {
      nextCoordinates[0] = [nextCoords[0], nextCoords[1]];
    }
    if (edge.toRef === refId) {
      const lastIndex = nextCoordinates.length - 1;
      nextCoordinates[lastIndex] = [nextCoords[0], nextCoords[1]];
    }

    nextEdges[edgeRefId] = {
      ...edge,
      coordinates: nextCoordinates,
    };
  }

  return nextEdges;
}

export function applyMoveNode(state: CommandStateSlice, cmd: MoveNodeCommand): CommandStateSlice {
  const node = state.nodes[cmd.refId];
  if (!node) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [cmd.refId]: {
        ...node,
        coordinates: [cmd.toCoords[0], cmd.toCoords[1]],
      },
    },
    edges: patchEdgesForNode(state.edges, cmd.refId, cmd.toCoords),
  };
}

export function revertMoveNode(state: CommandStateSlice, cmd: MoveNodeCommand): CommandStateSlice {
  const node = state.nodes[cmd.refId];
  if (!node) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [cmd.refId]: {
        ...node,
        coordinates: [cmd.fromCoords[0], cmd.fromCoords[1]],
      },
    },
    edges: patchEdgesForNode(state.edges, cmd.refId, cmd.fromCoords),
  };
}

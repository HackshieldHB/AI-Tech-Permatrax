import type { CommandStateSlice, AddEdgeCommand } from './types';

export function applyAddEdge(state: CommandStateSlice, cmd: AddEdgeCommand): CommandStateSlice {
  return {
    ...state,
    edges: {
      ...state.edges,
      [cmd.refId]: {
        refId: cmd.refId,
        fromRef: cmd.fromRef,
        toRef: cmd.toRef,
        type: cmd.edgeType,
        origin: 'MANUAL',
        coordinates: cmd.coordinates,
        properties: {},
      },
    },
  };
}

export function revertAddEdge(state: CommandStateSlice, cmd: AddEdgeCommand): CommandStateSlice {
  const nextEdges = { ...state.edges };
  delete nextEdges[cmd.refId];

  return {
    ...state,
    edges: nextEdges,
  };
}

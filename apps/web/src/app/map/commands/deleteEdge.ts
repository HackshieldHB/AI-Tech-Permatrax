import type { CommandStateSlice, DeleteEdgeCommand } from './types';

export function applyDeleteEdge(state: CommandStateSlice, cmd: DeleteEdgeCommand): CommandStateSlice {
  const nextEdges = { ...state.edges };
  delete nextEdges[cmd.refId];

  return {
    ...state,
    edges: nextEdges,
  };
}

export function revertDeleteEdge(state: CommandStateSlice, cmd: DeleteEdgeCommand): CommandStateSlice {
  return {
    ...state,
    edges: {
      ...state.edges,
      [cmd.refId]: cmd.removedEdge,
    },
  };
}

import type { CommandStateSlice, UpdateEdgeCommand } from './types';

export function applyUpdateEdge(state: CommandStateSlice, cmd: UpdateEdgeCommand): CommandStateSlice {
  const edge = state.edges[cmd.refId];
  if (!edge) return state;

  return {
    ...state,
    edges: {
      ...state.edges,
      [cmd.refId]: {
        ...edge,
        properties: { ...edge.properties, ...cmd.newProperties },
      },
    },
  };
}

export function revertUpdateEdge(state: CommandStateSlice, cmd: UpdateEdgeCommand): CommandStateSlice {
  const edge = state.edges[cmd.refId];
  if (!edge) return state;

  return {
    ...state,
    edges: {
      ...state.edges,
      [cmd.refId]: {
        ...edge,
        properties: { ...edge.properties, ...cmd.oldProperties },
      },
    },
  };
}

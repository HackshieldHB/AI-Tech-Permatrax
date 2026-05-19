import type { CommandStateSlice, UpdateNodeCommand } from './types';

export function applyUpdateNode(state: CommandStateSlice, cmd: UpdateNodeCommand): CommandStateSlice {
  const node = state.nodes[cmd.refId];
  if (!node) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [cmd.refId]: {
        ...node,
        properties: { ...node.properties, ...cmd.newProperties },
      },
    },
  };
}

export function revertUpdateNode(state: CommandStateSlice, cmd: UpdateNodeCommand): CommandStateSlice {
  const node = state.nodes[cmd.refId];
  if (!node) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [cmd.refId]: {
        ...node,
        properties: { ...node.properties, ...cmd.oldProperties },
      },
    },
  };
}

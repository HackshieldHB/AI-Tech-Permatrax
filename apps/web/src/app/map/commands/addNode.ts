import type { AddNodeCommand, CommandStateSlice } from './types';

export function applyAddNode(state: CommandStateSlice, cmd: AddNodeCommand): CommandStateSlice {
  if (state.nodes[cmd.refId]) return state; // Already exists
  
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [cmd.refId]: {
        refId: cmd.refId,
        type: cmd.nodeType,
        origin: 'MANUAL',
        coordinates: [cmd.coordinates[0], cmd.coordinates[1]],
        properties: {},
      },
    },
  };
}

export function revertAddNode(state: CommandStateSlice, cmd: AddNodeCommand): CommandStateSlice {
  const nextNodes = { ...state.nodes };
  delete nextNodes[cmd.refId];

  return {
    ...state,
    nodes: nextNodes,
  };
}

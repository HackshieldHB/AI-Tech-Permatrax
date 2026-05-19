import { applyMoveNode, revertMoveNode } from './moveNode';
import { applyAddNode, revertAddNode } from './addNode';
import { applyDeleteNode, revertDeleteNode } from './deleteNode';
import { applyAddEdge, revertAddEdge } from './addEdge';
import { applyDeleteEdge, revertDeleteEdge } from './deleteEdge';
import { applyUpdateNode, revertUpdateNode } from './updateNode';
import { applyUpdateEdge, revertUpdateEdge } from './updateEdge';
import type { Command, CommandStateSlice } from './types';

export function applyCommand(state: CommandStateSlice, cmd: Command): CommandStateSlice {
  switch (cmd.type) {
    case 'MoveNode':
      return applyMoveNode(state, cmd);
    case 'AddNode':
      return applyAddNode(state, cmd);
    case 'DeleteNode':
      return applyDeleteNode(state, cmd);
    case 'AddEdge':
      return applyAddEdge(state, cmd);
    case 'DeleteEdge':
      return applyDeleteEdge(state, cmd);
    case 'UpdateNode':
      return applyUpdateNode(state, cmd);
    case 'UpdateEdge':
      return applyUpdateEdge(state, cmd);
    default:
      return state;
  }
}

export function revertCommand(state: CommandStateSlice, cmd: Command): CommandStateSlice {
  switch (cmd.type) {
    case 'MoveNode':
      return revertMoveNode(state, cmd);
    case 'AddNode':
      return revertAddNode(state, cmd);
    case 'DeleteNode':
      return revertDeleteNode(state, cmd);
    case 'AddEdge':
      return revertAddEdge(state, cmd);
    case 'DeleteEdge':
      return revertDeleteEdge(state, cmd);
    case 'UpdateNode':
      return revertUpdateNode(state, cmd);
    case 'UpdateEdge':
      return revertUpdateEdge(state, cmd);
    default:
      return state;
  }
}

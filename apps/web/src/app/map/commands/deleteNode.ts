import type { CommandStateSlice, DeleteNodeCommand } from './types';

export function applyDeleteNode(state: CommandStateSlice, cmd: DeleteNodeCommand): CommandStateSlice {
  const nodeExists = state.nodes[cmd.refId];
  if (!nodeExists) return state;

  const nextNodes = { ...state.nodes };
  delete nextNodes[cmd.refId];

  const nextEdges = { ...state.edges };
  cmd.removedEdges.forEach(edge => {
    delete nextEdges[edge.refId];
  });

  return {
    ...state,
    nodes: nextNodes,
    edges: nextEdges,
  };
}

export function revertDeleteNode(state: CommandStateSlice, cmd: DeleteNodeCommand): CommandStateSlice {
  const nextNodes = {
    ...state.nodes,
    [cmd.removedNode.refId]: JSON.parse(JSON.stringify(cmd.removedNode)),
  };

  const nextEdges = { ...state.edges };
  cmd.removedEdges.forEach(edge => {
    nextEdges[edge.refId] = JSON.parse(JSON.stringify(edge));
  });

  return {
    ...state,
    nodes: nextNodes,
    edges: nextEdges,
  };
}

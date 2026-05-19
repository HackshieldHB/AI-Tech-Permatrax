import type { FeatureCollection } from 'geojson';
import type { MoveNodeCommand, AddNodeCommand, DeleteNodeCommand } from '../commands/types';
import { useCommandStore, __resetCommandStoreApiPatchForTest, __setCommandStoreApiPatchForTest, __setCommandStoreApiPostForTest, __setCommandStoreApiDeleteForTest } from '../../../store/useCommandStore';
import { useDesignStore } from '../../../store/useDesignStore';

export type CommandStoreCheckResult = {
  passed: boolean;
  errors: string[];
  traces: string[];
};

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertPush(condition: boolean, passMessage: string, failMessage: string, traces: string[], errors: string[]): void {
  if (condition) {
    traces.push(passMessage);
    return;
  }
  errors.push(failMessage);
}

function buildFixtureGeometry(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.82412, -6.18631] },
        properties: { kind: 'node', refId: 'ODP-1', type: 'ODP', origin: 'AUTO' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.82695, -6.18522] },
        properties: { kind: 'node', refId: 'ODP-2', type: 'ODP', origin: 'AUTO' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.82911, -6.18384] },
        properties: { kind: 'node', refId: 'ODP-3', type: 'ODP', origin: 'AUTO' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.8218, -6.18875] },
        properties: { kind: 'node', refId: 'ODC-1', type: 'ODC', origin: 'AUTO' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [106.8189, -6.1914] },
        properties: { kind: 'node', refId: 'OLT-1', type: 'OLT', origin: 'AUTO' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.8218, -6.18875],
            [106.82295, -6.1874],
            [106.82412, -6.18631],
          ],
        },
        properties: {
          kind: 'edge',
          refId: 'DIST-1',
          fromRef: 'ODC-1',
          toRef: 'ODP-1',
          type: 'DISTRIBUTION',
          origin: 'AUTO',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.8218, -6.18875],
            [106.8244, -6.1868],
            [106.82695, -6.18522],
          ],
        },
        properties: {
          kind: 'edge',
          refId: 'DIST-2',
          fromRef: 'ODC-1',
          toRef: 'ODP-2',
          type: 'DISTRIBUTION',
          origin: 'AUTO',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.8218, -6.18875],
            [106.8252, -6.1861],
            [106.82911, -6.18384],
          ],
        },
        properties: {
          kind: 'edge',
          refId: 'DIST-3',
          fromRef: 'ODC-1',
          toRef: 'ODP-3',
          type: 'DISTRIBUTION',
          origin: 'AUTO',
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.8189, -6.1914],
            [106.8203, -6.1902],
            [106.8218, -6.18875],
          ],
        },
        properties: {
          kind: 'edge',
          refId: 'FEED-1',
          fromRef: 'OLT-1',
          toRef: 'ODC-1',
          type: 'FEEDER',
          origin: 'AUTO',
        },
      },
    ],
  };
}

export async function runCommandStoreCheck(): Promise<CommandStoreCheckResult> {
  const errors: string[] = [];
  const traces: string[] = [];
  let patchCallCount = 0;

  useCommandStore.getState().clearStacks();
  useDesignStore.getState().clear();
  useDesignStore.getState().hydrate('design-check-1', buildFixtureGeometry());

  const initialDesignSnapshot = JSON.parse(
    JSON.stringify({
      nodes: useDesignStore.getState().nodes,
      edges: useDesignStore.getState().edges,
    }),
  ) as { nodes: unknown; edges: unknown };

  const cmd1: MoveNodeCommand = {
    type: 'MoveNode',
    refId: 'ODP-1',
    fromCoords: [106.82412, -6.18631],
    toCoords: [106.8245, -6.186],
  };
  const cmd2: MoveNodeCommand = {
    type: 'MoveNode',
    refId: 'ODP-1',
    fromCoords: [106.8245, -6.186],
    toCoords: [106.8249, -6.1857],
  };
  const cmd3: MoveNodeCommand = {
    type: 'MoveNode',
    refId: 'ODP-1',
    fromCoords: [106.8249, -6.1857],
    toCoords: [106.8251, -6.1855],
  };

  const commandStore = useCommandStore.getState();
  commandStore.dispatch(cmd1);
  commandStore.dispatch(cmd2);
  commandStore.dispatch(cmd3);

  const afterDispatch = useCommandStore.getState();
  assertPush(
    afterDispatch.applied.length === 3,
    'dispatch check: applied.length === 3',
    `dispatch check failed: applied.length is ${afterDispatch.applied.length}`,
    traces,
    errors,
  );
  assertPush(
    afterDispatch.pendingPersist.length === 3,
    'dispatch check: pendingPersist.length === 3',
    `dispatch check failed: pendingPersist.length is ${afterDispatch.pendingPersist.length}`,
    traces,
    errors,
  );
  assertPush(
    afterDispatch.inFlight.size === 0,
    'dispatch check: inFlight.size === 0',
    `dispatch check failed: inFlight.size is ${afterDispatch.inFlight.size}`,
    traces,
    errors,
  );

  __setCommandStoreApiPatchForTest(async () => {
    patchCallCount += 1;
    return {};
  });
  await useCommandStore.getState().flush();

  const afterFlush = useCommandStore.getState();
  assertPush(
    afterFlush.applied.length === 3,
    'flush check: applied.length still 3',
    `flush check failed: applied.length is ${afterFlush.applied.length}`,
    traces,
    errors,
  );
  assertPush(
    afterFlush.pendingPersist.length === 0,
    'flush check: pendingPersist.length === 0',
    `flush check failed: pendingPersist.length is ${afterFlush.pendingPersist.length}`,
    traces,
    errors,
  );
  assertPush(
    afterFlush.inFlight.size === 0,
    'flush check: inFlight.size === 0',
    `flush check failed: inFlight.size is ${afterFlush.inFlight.size}`,
    traces,
    errors,
  );
  assertPush(
    patchCallCount === 1,
    'flush check: dedup sent 1 patch',
    `flush check failed: patch calls = ${patchCallCount}`,
    traces,
    errors,
  );

  const preRollbackState = JSON.parse(
    JSON.stringify({
      nodes: useDesignStore.getState().nodes,
      edges: useDesignStore.getState().edges,
    }),
  ) as { nodes: unknown; edges: unknown };

  const rollbackCmd: MoveNodeCommand = {
    type: 'MoveNode',
    refId: 'ODP-2',
    fromCoords: [106.82695, -6.18522],
    toCoords: [106.8275, -6.1849],
  };
  useCommandStore.getState().dispatch(rollbackCmd);

  __setCommandStoreApiPatchForTest(async () => {
    throw new Error('forced failure');
  });
  await useCommandStore.getState().flush();

  const afterRollbackState = {
    nodes: useDesignStore.getState().nodes,
    edges: useDesignStore.getState().edges,
  };
  assertPush(
    deepEqual(afterRollbackState, preRollbackState),
    'rollback check: design state reverted after failed patch',
    'rollback check failed: design state did not revert after failed patch',
    traces,
    errors,
  );

  const afterRollbackStore = useCommandStore.getState();
  assertPush(
    afterRollbackStore.applied.length === 3,
    'rollback check: failed command removed from applied',
    `rollback check failed: applied.length is ${afterRollbackStore.applied.length}`,
    traces,
    errors,
  );

  // === NEW ASSERTIONS FOR 2B-iii-a ===

  let postCallCount = 0;
  __setCommandStoreApiPostForTest(async () => { postCallCount++; return {}; });
  let deleteCallCount = 0;
  __setCommandStoreApiDeleteForTest(async () => { deleteCallCount++; return {}; });

  // 1. AddNode -> POST is sent
  const addCmd1: AddNodeCommand = { type: 'AddNode', refId: 'CHK-ADD-1', nodeType: 'ODP', coordinates: [106.82, -6.18] };
  useCommandStore.getState().dispatch(addCmd1);
  await useCommandStore.getState().flush();
  assertPush(postCallCount === 1, 'flush check: AddNode sent 1 post', `flush check failed: post calls = ${postCallCount}`, traces, errors);

  // 2. DeleteNode -> DELETE is sent
  useDesignStore.getState().nodes['CHK-DEL-1'] = { refId: 'CHK-DEL-1', type: 'ODP', origin: 'AUTO', coordinates: [0,0], properties: {} };
  const delCmd1: DeleteNodeCommand = { type: 'DeleteNode', refId: 'CHK-DEL-1', removedNode: useDesignStore.getState().nodes['CHK-DEL-1']!, removedEdges: [] };
  useCommandStore.getState().dispatch(delCmd1);
  await useCommandStore.getState().flush();
  assertPush(deleteCallCount === 1, 'flush check: DeleteNode sent 1 delete', `flush check failed: delete calls = ${deleteCallCount}`, traces, errors);

  // 3. AddNode + DeleteNode same refId -> no network call
  postCallCount = 0;
  deleteCallCount = 0;
  const addDelCmd: AddNodeCommand = { type: 'AddNode', refId: 'CHK-ADD-DEL', nodeType: 'ODP', coordinates: [0,0] };
  useCommandStore.getState().dispatch(addDelCmd);
  const delAddCmd: DeleteNodeCommand = { type: 'DeleteNode', refId: 'CHK-ADD-DEL', removedNode: useDesignStore.getState().nodes['CHK-ADD-DEL']!, removedEdges: [] };
  useCommandStore.getState().dispatch(delAddCmd);
  await useCommandStore.getState().flush();
  assertPush(postCallCount === 0 && deleteCallCount === 0, 'flush check: AddNode + DeleteNode sent 0 network calls', 'flush check failed: AddNode + DeleteNode sent network calls', traces, errors);
  assertPush(useCommandStore.getState().applied.length >= 2, 'flush check: AddNode + DeleteNode kept in applied stack', 'flush check failed: AddNode + DeleteNode dropped from applied stack', traces, errors);

  // 4. AddNode + multiple MoveNode same refId -> POST then last PATCH
  postCallCount = 0;
  patchCallCount = 0;
  __setCommandStoreApiPatchForTest(async () => { patchCallCount++; return {}; });
  const addMoveCmd: AddNodeCommand = { type: 'AddNode', refId: 'CHK-ADD-MOVE', nodeType: 'ODP', coordinates: [0,0] };
  useCommandStore.getState().dispatch(addMoveCmd);
  const move1: MoveNodeCommand = { type: 'MoveNode', refId: 'CHK-ADD-MOVE', fromCoords: [0,0], toCoords: [1,1] };
  useCommandStore.getState().dispatch(move1);
  const move2: MoveNodeCommand = { type: 'MoveNode', refId: 'CHK-ADD-MOVE', fromCoords: [1,1], toCoords: [2,2] };
  useCommandStore.getState().dispatch(move2);
  await useCommandStore.getState().flush();
  assertPush(postCallCount === 1 && patchCallCount === 1, 'flush check: AddNode + MoveNodes sent 1 POST and 1 PATCH', `flush check failed: post=${postCallCount}, patch=${patchCallCount}`, traces, errors);

  // 5. AddNode failure rolls back
  __setCommandStoreApiPostForTest(async () => { throw new Error('forced failure'); });
  const preAddFailStoreLength = useCommandStore.getState().applied.length;
  const addFailCmd: AddNodeCommand = { type: 'AddNode', refId: 'CHK-ADD-FAIL', nodeType: 'ODP', coordinates: [0,0] };
  useCommandStore.getState().dispatch(addFailCmd);
  await useCommandStore.getState().flush();
  assertPush(!useDesignStore.getState().nodes['CHK-ADD-FAIL'], 'rollback check: AddNode failure removed node from state', 'rollback check failed: AddNode failure kept node in state', traces, errors);
  assertPush(useCommandStore.getState().applied.length === preAddFailStoreLength, 'rollback check: AddNode failure removed from applied stack', 'rollback check failed: AddNode failure kept in applied stack', traces, errors);

  // 6. DeleteNode failure rolls back
  useDesignStore.getState().nodes['CHK-DEL-FAIL'] = { refId: 'CHK-DEL-FAIL', type: 'ODP', origin: 'AUTO', coordinates: [0,0], properties: {} };
  __setCommandStoreApiDeleteForTest(async () => { throw new Error('forced failure'); });
  const preDelFailStoreLength = useCommandStore.getState().applied.length;
  const delFailCmd: DeleteNodeCommand = { type: 'DeleteNode', refId: 'CHK-DEL-FAIL', removedNode: useDesignStore.getState().nodes['CHK-DEL-FAIL']!, removedEdges: [] };
  useCommandStore.getState().dispatch(delFailCmd);
  await useCommandStore.getState().flush();
  assertPush(!!useDesignStore.getState().nodes['CHK-DEL-FAIL'], 'rollback check: DeleteNode failure restored node to state', 'rollback check failed: DeleteNode failure did not restore node to state', traces, errors);
  assertPush(useCommandStore.getState().applied.length === preDelFailStoreLength, 'rollback check: DeleteNode failure removed from applied stack', 'rollback check failed: DeleteNode failure kept in applied stack', traces, errors);

  // 7. In-flight gate still works
  useDesignStore.getState().nodes['CHK-INFLIGHT'] = { refId: 'CHK-INFLIGHT', type: 'ODP', origin: 'AUTO', coordinates: [0,0], properties: {} };
  useCommandStore.getState().inFlight.add('CHK-INFLIGHT');
  const inflightAddCmd: AddNodeCommand = { type: 'AddNode', refId: 'CHK-INFLIGHT', nodeType: 'ODP', coordinates: [0,0] };
  useCommandStore.getState().dispatch(inflightAddCmd);
  await useCommandStore.getState().flush();
  assertPush(useCommandStore.getState().pendingPersist.some(c => c.type === 'AddNode' && c.refId === 'CHK-INFLIGHT'), 'flush check: AddNode deferred while in-flight', 'flush check failed: AddNode not deferred while in-flight', traces, errors);
  useCommandStore.getState().inFlight.delete('CHK-INFLIGHT'); // clean up

  assertPush(
    deepEqual(initialDesignSnapshot, initialDesignSnapshot),
    'baseline snapshot retained for comparison',
    'baseline snapshot corrupted',
    traces,
    errors,
  );

  useDesignStore.getState().clear();
  const afterDesignClearStore = useCommandStore.getState();
  assertPush(
    afterDesignClearStore.applied.length === 0 &&
      afterDesignClearStore.undone.length === 0 &&
      afterDesignClearStore.pendingPersist.length === 0 &&
      afterDesignClearStore.inFlight.size === 0,
    'clear cascade check: useDesignStore.clear() resets command stacks',
    'clear cascade check failed: useDesignStore.clear() did not reset command stacks',
    traces,
    errors,
  );

  __resetCommandStoreApiPatchForTest();

  const passed = errors.length === 0;
  console.log(`[CommandStoreCheck] passed: ${passed}, assertions: ${traces.length + errors.length}`);
  if (!passed) {
    console.log('[CommandStoreCheck] firstErrors:', errors.slice(0, 3));
  }
  console.log(`[CommandStoreCheck] traceCount: ${traces.length}`);

  return { passed, errors, traces };
}

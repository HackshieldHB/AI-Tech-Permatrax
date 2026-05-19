import { applyCommand, revertCommand } from '../commands/core';
import type { Command, CommandStateSlice, MoveNodeCommand } from '../commands/types';

export type SoakResult = {
  passed: boolean;
  errors: string[];
  traces: string[];
};

type Rng = () => number;

function createLcg(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], (b as unknown[])[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[keysA[i]!], (b as Record<string, unknown>)[keysB[i]!])) return false;
  }
  return true;
}

function buildFixture(): CommandStateSlice {
  const nodes: CommandStateSlice['nodes'] = {
    'ODP-1': { refId: 'ODP-1', type: 'ODP', origin: 'AUTO', coordinates: [106.82412, -6.18631], properties: {} },
    'ODP-2': { refId: 'ODP-2', type: 'ODP', origin: 'AUTO', coordinates: [106.82695, -6.18522], properties: {} },
    'ODP-3': { refId: 'ODP-3', type: 'ODP', origin: 'AUTO', coordinates: [106.82911, -6.18384], properties: {} },
    'ODC-1': { refId: 'ODC-1', type: 'ODC', origin: 'AUTO', coordinates: [106.8218, -6.18875], properties: {} },
    'OLT-1': { refId: 'OLT-1', type: 'OLT', origin: 'AUTO', coordinates: [106.8189, -6.1914], properties: {} },
  };

  const edges: CommandStateSlice['edges'] = {
    'DIST-1': {
      refId: 'DIST-1',
      fromRef: 'ODC-1',
      toRef: 'ODP-1',
      type: 'DISTRIBUTION',
      origin: 'AUTO',
      coordinates: [
        [106.8218, -6.18875],
        [106.82295, -6.1874],
        [106.82412, -6.18631],
      ],
      properties: {},
    },
    'DIST-2': {
      refId: 'DIST-2',
      fromRef: 'ODC-1',
      toRef: 'ODP-2',
      type: 'DISTRIBUTION',
      origin: 'AUTO',
      coordinates: [
        [106.8218, -6.18875],
        [106.8244, -6.1868],
        [106.82695, -6.18522],
      ],
      properties: {},
    },
    'DIST-3': {
      refId: 'DIST-3',
      fromRef: 'ODC-1',
      toRef: 'ODP-3',
      type: 'DISTRIBUTION',
      origin: 'AUTO',
      coordinates: [
        [106.8218, -6.18875],
        [106.8252, -6.1861],
        [106.82911, -6.18384],
      ],
      properties: {},
    },
    'FEED-1': {
      refId: 'FEED-1',
      fromRef: 'OLT-1',
      toRef: 'ODC-1',
      type: 'FEEDER',
      origin: 'AUTO',
      coordinates: [
        [106.8189, -6.1914],
        [106.8203, -6.1902],
        [106.8218, -6.18875],
      ],
      properties: {},
    },
  };

  return { nodes, edges };
}

function createMoveCommands(initial: CommandStateSlice, seed: number, count: number): MoveNodeCommand[] {
  const rng = createLcg(seed);
  const nodeRefIds = Object.keys(initial.nodes);
  const cursor = deepClone(initial.nodes);
  const commands: MoveNodeCommand[] = [];

  for (let i = 0; i < count; i += 1) {
    const pickIndex = Math.floor(rng() * nodeRefIds.length);
    const refId = nodeRefIds[pickIndex] ?? nodeRefIds[0];
    const current = cursor[refId];
    if (!current) continue;

    const dLng = (rng() - 0.5) * 0.0024;
    const dLat = (rng() - 0.5) * 0.0024;
    const toCoords: [number, number] = [
      Number((current.coordinates[0] + dLng).toFixed(6)),
      Number((current.coordinates[1] + dLat).toFixed(6)),
    ];

    const cmd: MoveNodeCommand = {
      type: 'MoveNode',
      refId,
      fromCoords: [current.coordinates[0], current.coordinates[1]],
      toCoords,
    };

    commands.push(cmd);
    cursor[refId] = { ...current, coordinates: [toCoords[0], toCoords[1]] };
  }

  return commands;
}

function assertPush(
  condition: boolean,
  passMessage: string,
  failMessage: string,
  traces: string[],
  errors: string[],
): void {
  if (condition) {
    traces.push(passMessage);
    return;
  }
  errors.push(failMessage);
}

export function runCommandSoakTest(): SoakResult {
  const errors: string[] = [];
  const traces: string[] = [];
  const fixture = buildFixture();

  // 1) initial snapshot
  const initial = deepClone(fixture);
  assertPush(
    deepEqual(fixture, initial),
    '1) captured initial snapshot',
    '1) failed to capture initial snapshot',
    traces,
    errors,
  );

  // 2) deterministic commands
  const commands = createMoveCommands(initial, 20260506, 20);
  assertPush(
    commands.length === 20,
    '2) generated 20 deterministic commands',
    `2) expected 20 commands, got ${commands.length}`,
    traces,
    errors,
  );

  let state = deepClone(initial);

  // 3) apply with scoped assertions
  commands.forEach((cmd, idx) => {
    state = applyCommand(state, cmd);

    const movedNode = state.nodes[cmd.refId];
    assertPush(
      !!movedNode && deepEqual(movedNode.coordinates, cmd.toCoords),
      `3.${idx + 1}) node ${cmd.refId} moved`,
      `3.${idx + 1}) node ${cmd.refId} coordinates mismatch`,
      traces,
      errors,
    );

    Object.values(state.edges).forEach((edge) => {
      if (edge.fromRef === cmd.refId) {
        assertPush(
          deepEqual(edge.coordinates[0], cmd.toCoords),
          `3.${idx + 1}) edge ${edge.refId} start synced`,
          `3.${idx + 1}) edge ${edge.refId} start not synced to ${cmd.refId}`,
          traces,
          errors,
        );
      }

      if (edge.toRef === cmd.refId) {
        const last = edge.coordinates[edge.coordinates.length - 1];
        assertPush(
          deepEqual(last, cmd.toCoords),
          `3.${idx + 1}) edge ${edge.refId} end synced`,
          `3.${idx + 1}) edge ${edge.refId} end not synced to ${cmd.refId}`,
          traces,
          errors,
        );
      }
    });
  });

  // mutation guard
  assertPush(
    deepEqual(initial, fixture),
    '3.x) fixture remains unchanged after apply sequence',
    '3.x) detected input mutation during apply sequence',
    traces,
    errors,
  );

  // 4) snapshot after apply
  const afterApplied = deepClone(state);
  assertPush(
    deepEqual(state, afterApplied),
    '4) captured afterApplied snapshot',
    '4) failed to capture afterApplied snapshot',
    traces,
    errors,
  );

  // 5) revert reverse
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    state = revertCommand(state, commands[i] as Command);
  }
  traces.push('5) reverted commands in reverse order');

  // 6) reverted equals initial
  assertPush(
    deepEqual(state, initial),
    '6) reverted state equals initial',
    '6) reverted state does not equal initial',
    traces,
    errors,
  );

  // 7) apply again
  commands.forEach((cmd) => {
    state = applyCommand(state, cmd);
  });
  traces.push('7) re-applied commands in original order');

  // 8) equals afterApplied
  assertPush(
    deepEqual(state, afterApplied),
    '8) re-apply state equals afterApplied',
    '8) re-apply state does not equal afterApplied',
    traces,
    errors,
  );

  // 9) apply 10 more + revert 10 should stay stable
  const extra = createMoveCommands(afterApplied, 20260601, 10);
  extra.forEach((cmd) => {
    state = applyCommand(state, cmd);
  });
  for (let i = extra.length - 1; i >= 0; i -= 1) {
    state = revertCommand(state, extra[i] as Command);
  }
  assertPush(
    deepEqual(state, afterApplied),
    '9) apply/revert 10 commands preserves stable state',
    '9) apply/revert 10 commands changed stable state',
    traces,
    errors,
  );

  // 10) JSON serialization round-trip
  commands.forEach((cmd, idx) => {
    const roundTrip = JSON.parse(JSON.stringify(cmd));
    assertPush(
      deepEqual(roundTrip, cmd),
      `10.${idx + 1}) command ${idx + 1} json round-trip ok`,
      `10.${idx + 1}) command ${idx + 1} json round-trip failed`,
      traces,
      errors,
    );
  });

  // 11) AddNode isolation loop
  let addState = deepClone(afterApplied);
  const addCommands: Command[] = [];
  for (let i = 0; i < 10; i++) {
    const cmd: Command = {
      type: 'AddNode',
      refId: `NEW-ODP-${i}`,
      nodeType: 'ODP',
      coordinates: [106.82000 + i * 0.001, -6.19000 + i * 0.001],
    };
    addCommands.push(cmd);
    addState = applyCommand(addState, cmd);
    assertPush(
      !!addState.nodes[`NEW-ODP-${i}`],
      `11.${i}) AddNode apply added node NEW-ODP-${i}`,
      `11.${i}) AddNode apply failed to add node NEW-ODP-${i}`,
      traces,
      errors
    );
  }
  for (let i = addCommands.length - 1; i >= 0; i--) {
    addState = revertCommand(addState, addCommands[i]!);
  }
  assertPush(
    deepEqual(addState, afterApplied),
    '11.x) AddNode loop revert restored state exactly',
    '11.x) AddNode loop revert failed to restore state',
    traces,
    errors
  );

  // 12) DeleteNode isolation loop
  let delState = deepClone(afterApplied);
  const delCommands: Command[] = [];
  const nodesToDel = ['ODP-1', 'ODP-2', 'ODC-1'];
  nodesToDel.forEach((refId, i) => {
    const nodeToDelete = delState.nodes[refId];
    if (!nodeToDelete) return;
    const edgesToDelete = Object.values(delState.edges).filter(e => e.fromRef === refId || e.toRef === refId);
    const cmd: Command = {
      type: 'DeleteNode',
      refId,
      removedNode: nodeToDelete,
      removedEdges: edgesToDelete,
    };
    delCommands.push(cmd);
    delState = applyCommand(delState, cmd);
    assertPush(
      !delState.nodes[refId] && edgesToDelete.every(e => !delState.edges[e.refId]),
      `12.${i}) DeleteNode apply removed node ${refId} and edges`,
      `12.${i}) DeleteNode apply failed to remove all items for ${refId}`,
      traces,
      errors
    );
  });
  for (let i = delCommands.length - 1; i >= 0; i--) {
    delState = revertCommand(delState, delCommands[i]!);
  }
  assertPush(
    deepEqual(delState, afterApplied),
    '12.x) DeleteNode loop revert restored state exactly',
    '12.x) DeleteNode loop revert failed to restore state',
    traces,
    errors
  );

  // 13) Mixed Sequence
  let mixState = deepClone(afterApplied);
  const mixAddCmd: Command = { type: 'AddNode', refId: 'MIX-ODP-1', nodeType: 'ODP', coordinates: [106.81, -6.19] };
  const mixMoveCmd: Command = { type: 'MoveNode', refId: 'MIX-ODP-1', fromCoords: [106.81, -6.19], toCoords: [106.815, -6.195] };
  
  mixState = applyCommand(mixState, mixAddCmd);
  mixState = applyCommand(mixState, mixMoveCmd);
  
  const mixDelCmd: Command = { 
    type: 'DeleteNode', 
    refId: 'MIX-ODP-1', 
    removedNode: mixState.nodes['MIX-ODP-1']!, 
    removedEdges: [] 
  };
  mixState = applyCommand(mixState, mixDelCmd);
  
  assertPush(
    !mixState.nodes['MIX-ODP-1'],
    '13) Mixed sequence apply finished cleanly',
    '13) Mixed sequence apply left residual data',
    traces,
    errors
  );
  
  mixState = revertCommand(mixState, mixDelCmd);
  mixState = revertCommand(mixState, mixMoveCmd);
  mixState = revertCommand(mixState, mixAddCmd);
  
  assertPush(
    deepEqual(mixState, afterApplied),
    '13) Mixed sequence revert restored state exactly',
    '13) Mixed sequence revert failed to restore state',
    traces,
    errors
  );

  // 14) JSON serialization round-trip for new commands
  [...addCommands, ...delCommands, mixAddCmd, mixDelCmd].forEach((cmd, idx) => {
    const roundTrip = JSON.parse(JSON.stringify(cmd));
    assertPush(
      deepEqual(roundTrip, cmd),
      `14.${idx + 1}) new command json round-trip ok`,
      `14.${idx + 1}) new command json round-trip failed`,
      traces,
      errors
    );
  });

  const passed = errors.length === 0;
  const assertionCount = traces.length + errors.length;
  console.log(`[CommandSoakTest] passed: ${passed}, assertions: ${assertionCount}`);
  if (!passed) {
    console.log('[CommandSoakTest] firstErrors:', errors.slice(0, 3));
  }
  console.log(`[CommandSoakTest] traceCount: ${traces.length}`);

  return { passed, errors, traces };
}

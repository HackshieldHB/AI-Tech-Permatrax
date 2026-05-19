export type SerializablePrimitive = string | number | boolean | null;
export type SerializableValue =
  | SerializablePrimitive
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export type Coordinates2D = [number, number];
export type CommandNodeType = 'OLT' | 'ODC' | 'ODP' | 'SPLITTER' | 'SPLICE' | 'POLE' | 'CONNECTOR';
export type CommandEdgeType = 'FEEDER' | 'DISTRIBUTION' | 'DROP';
export type CommandOrigin = 'AUTO' | 'MANUAL' | 'MODIFIED';

export type CommandStateNode = {
  refId: string;
  type: CommandNodeType;
  origin: CommandOrigin;
  coordinates: Coordinates2D;
  properties: Record<string, unknown>;
};

export type CommandStateEdge = {
  refId: string;
  fromRef: string;
  toRef: string;
  type: CommandEdgeType;
  origin: CommandOrigin;
  coordinates: Coordinates2D[];
  properties: Record<string, unknown>;
};

export type CommandStateSlice = {
  nodes: Record<string, CommandStateNode>;
  edges: Record<string, CommandStateEdge>;
};

export type MoveNodeCommand = {
  type: 'MoveNode';
  refId: string;
  fromCoords: Coordinates2D;
  toCoords: Coordinates2D;
};

export type AddNodeCommand = {
  type: 'AddNode';
  refId: string;
  nodeType: CommandNodeType;
  coordinates: Coordinates2D;
};

export type DeleteNodeCommand = {
  type: 'DeleteNode';
  refId: string;
  removedNode: CommandStateNode;
  removedEdges: CommandStateEdge[];
};

export type AddEdgeCommand = {
  type: 'AddEdge';
  refId: string;
  fromRef: string;
  toRef: string;
  edgeType: CommandEdgeType;
  coordinates: Coordinates2D[];
};

export type DeleteEdgeCommand = {
  type: 'DeleteEdge';
  refId: string;
  removedEdge: CommandStateEdge;
};

export type UpdateNodeCommand = {
  type: 'UpdateNode';
  refId: string;
  oldProperties: Record<string, unknown>;
  newProperties: Record<string, unknown>;
};

export type UpdateEdgeCommand = {
  type: 'UpdateEdge';
  refId: string;
  oldProperties: Record<string, unknown>;
  newProperties: Record<string, unknown>;
};

export type Command = MoveNodeCommand | AddNodeCommand | DeleteNodeCommand | AddEdgeCommand | DeleteEdgeCommand | UpdateNodeCommand | UpdateEdgeCommand;

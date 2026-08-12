/** Mirrors the projections in the daemon's app/models/graph.py. */

export type RelationType = "depends_on" | "relates_to" | "part_of";

/** Where a piece of work stands. Closed — the roadmap draws these four. */
export type Status = "todo" | "doing" | "done" | "dropped";

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  thumbnail_url: string | null;
  tags: string[];
  /** Set only on memories that represent work. Absent on everything else. */
  status?: Status | null;
  /** YYYY-MM-DD, when it is meant to land. */
  target_date?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation_type: RelationType;
  weight: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ids removed since `since`. Empty on a full read. */
  deleted?: string[];
  /** The moment this describes — pass back as `since` to fetch the next delta. */
  as_of?: string;
  /** False when this is a delta rather than the whole graph. */
  complete?: boolean;
}

/** A file attached to a memory. Mirrors app/models/files.py. */
export interface FileRef {
  id: string;
  node_id: string;
  name: string;
  media_type: string;
  /** Bytes. */
  size: number;
  /** Path on the daemon, relative — join with API_URL to fetch it. */
  url: string;
  created_at: string;
}

/** Where a memory's claims came from. Mirrors app/models/sources.py. */
export interface SourceRef {
  id: string;
  node_id: string;
  url: string;
  title: string;
  /** Host, without the www — how a reader would name the site. */
  site: string;
  snippet: string;
  /** 1-based citation number, which `[[src:N]]` in the content refers to. */
  position: number;
  created_at: string;
}

/** The full record, fetched only when a node is opened. */
export interface NodeDetail extends GraphNode {
  content: string;
  metadata: Record<string, unknown>;
  files: FileRef[];
  sources: SourceRef[];
  created_at: string;
  updated_at: string;
}

/** Lightweight search hit — no Markdown body. */
export interface NodeSearchResult {
  id: string;
  type: string;
  title: string;
  summary: string;
}

/** Mirrors app/models/settings.py — the user's rendering preferences. */
export interface MediaSettings {
  /**
   * Whether the canvas will fetch what memory content points at.
   *
   * One switch about origin rather than four about file type: a memory can
   * name any URL, so rendering it means this machine fetches from whatever
   * host an agent wrote down. Files the daemon serves are never gated by it.
   */
  remote_content: boolean;
}

export interface AppSettings {
  media: MediaSettings;
}

/** Where the user placed a memory by hand. `z` is absent in the 2D canvas. */
export interface SavedPosition {
  x: number;
  y: number;
  z?: number | null;
}

export interface SavedLayout {
  mode: string;
  positions: Record<string, SavedPosition>;
}

export const EVENT_NEW_NODE = "EVENT_NEW_NODE";
export const EVENT_NODE_UPDATED = "EVENT_NODE_UPDATED";
export const EVENT_NODE_DELETED = "EVENT_NODE_DELETED";

export type GraphEvent =
  | { event: typeof EVENT_NEW_NODE; payload: { node: GraphNode; edges: GraphEdge[] } }
  | { event: typeof EVENT_NODE_UPDATED; payload: { node: GraphNode } }
  | { event: typeof EVENT_NODE_DELETED; payload: { node_id: string } };

export interface GraphEventHandlers {
  onNewNode: (node: GraphNode, edges: GraphEdge[]) => void;
  onNodeUpdated: (node: GraphNode) => void;
  onNodeDeleted: (nodeId: string) => void;
}

/**
 * The renderer mutates links in place, swapping the string endpoints for node
 * object references once the simulation runs. Reads must tolerate both.
 */
export type LinkEndpoint = string | GraphNode;

export function endpointId(endpoint: LinkEndpoint): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

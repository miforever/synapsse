import type {
  FileRef,
  GraphSnapshot,
  NodeDetail,
  NodeSearchResult,
  SavedLayout,
  Status,
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "synapsse.token";

/**
 * The daemon's token, when it has one.
 *
 * Kept in localStorage rather than an environment variable so it is not baked
 * into the bundle, and so a canvas served from anywhere can be pointed at a
 * daemon that is locked without a rebuild. Empty on a normal local run, where
 * the daemon has no token at all.
 */
export function authToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAuthToken(token: string): void {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Raised when the daemon has a token and we did not present the right one. */
export class Unauthorized extends Error {
  constructor() {
    super("This daemon needs a token");
    this.name = "Unauthorized";
  }
}

// The browser cannot set headers on a WebSocket, so the token rides in the
// query string — the one place the daemon also accepts it.
export function wsUrl(): string {
  const base = API_URL.replace(/^http/, "ws") + "/ws/graph";
  const token = authToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    signal,
    headers: authHeaders(),
  });
  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * The graph, or only what changed since a previous read.
 *
 * `since` is the `as_of` the daemon returned last time. It answers with the
 * memories written or edited, the edges added, and the ids of anything
 * deleted — so a browser holding a cached graph pays for the difference.
 */
export function fetchGraph(
  signal?: AbortSignal,
  since?: string,
): Promise<GraphSnapshot> {
  const path = since ? `/graph?since=${encodeURIComponent(since)}` : "/graph";
  return get<GraphSnapshot>(path, signal);
}

export function fetchNode(
  id: string,
  signal?: AbortSignal,
): Promise<NodeDetail> {
  return get<NodeDetail>(`/nodes/${encodeURIComponent(id)}`, signal);
}

export function fetchLayout(
  mode: string,
  signal?: AbortSignal,
): Promise<SavedLayout> {
  return get<SavedLayout>(`/layout/${mode}`, signal);
}

/**
 * Write the arrangement back.
 *
 * `keepalive` so a save fired as the page goes away is still delivered — an
 * ordinary fetch is cancelled when the document unloads, which is exactly the
 * moment the last arrangement needs saving.
 */
export function saveLayout(
  mode: string,
  positions: SavedLayout["positions"],
): Promise<Response> {
  return fetch(`${API_URL}/layout/${mode}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ positions }),
    keepalive: true,
  });
}

export function clearLayout(mode: string): Promise<Response> {
  return fetch(`${API_URL}/layout/${mode}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

/** Absolute address of an attachment, for an <img> or a link. */
export function fileUrl(file: Pick<FileRef, "url">): string {
  return `${API_URL}${file.url}`;
}

/**
 * Attach a file to a memory.
 *
 * multipart rather than a JSON body: the bytes go up as bytes, instead of
 * being base64'd into a string a third larger than the file itself. The
 * daemon broadcasts the change, so every open canvas picks the attachment up
 * without this having to tell anyone.
 */
export async function attachFile(
  nodeId: string,
  file: File,
): Promise<FileRef> {
  const body = new FormData();
  body.append("upload", file, file.name);

  const response = await fetch(
    `${API_URL}/nodes/${encodeURIComponent(nodeId)}/files`,
    { method: "POST", body },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 413
        ? `${file.name} is too large for this daemon`
        : `Could not attach ${file.name}`,
    );
  }
  return response.json() as Promise<FileRef>;
}

/**
 * Move a piece of work along.
 *
 * The canvas's first write. It goes through the same PATCH the agents use, so
 * a status set by hand and one set by an agent are the same edit — including
 * the broadcast, which is how every other open view finds out.
 */
export async function setNodeStatus(
  nodeId: string,
  status: Status,
): Promise<NodeDetail> {
  const response = await fetch(
    `${API_URL}/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  if (!response.ok) throw new Error("Could not update the status");
  return response.json() as Promise<NodeDetail>;
}

export async function detachFile(fileId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Could not remove the attachment");
}

export function searchNodes(
  query: string,
  signal?: AbortSignal,
): Promise<NodeSearchResult[]> {
  return get<NodeSearchResult[]>(
    `/search?q=${encodeURIComponent(query)}&limit=20`,
    signal,
  );
}

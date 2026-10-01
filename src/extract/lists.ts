// Generic list-sniffing engine for Tier-3 MCP connectors.
//
// Most MCP list/search tools return a payload with an array under a
// predictable key (issues, records, payments, videos, places, …) and rows
// whose fields cluster into a handful of shapes. Instead of 25 bespoke
// extractors, each connector registers a hint table and this engine maps
// payloads into list-card / table-card / stat-strip descriptors.
// Contract-first: null on any mismatch — the dispatch falls through to the
// generic mcp-result envelope, never throws.

import type { ListCardMedia, ListRow, StatStripMedia, TableCardMedia, ToolMedia, ToolPartLike } from "../types.js";
import { asString, headLines, isRunning, partMetadata } from "./helpers.js";

/** Pull the candidate payload: metadata-first, then parsed JSON output. */
export function payloadOf(part: ToolPartLike): Record<string, unknown> | null {
  const metadata = partMetadata(part);
  const candidates = [metadata];
  if (typeof part.state.output === "string") {
    try {
      const parsed = JSON.parse(part.state.output);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) candidates.unshift(parsed);
    } catch {
      // not JSON
    }
  }
  for (const c of candidates) {
    for (const key of ["result", "data", "payload"]) {
      const inner = c[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) candidates.push(inner as Record<string, unknown>);
    }
  }
  return candidates.find((c) => Object.keys(c).length > 0) ?? null;
}

/** Envelope keys that are never result lists (MCP transport plumbing). */
const ENVELOPE_KEYS = new Set(["mcp_content", "mcp_args", "args", "input", "ui", "_meta"]);

/** First array value in the payload whose objects match `minKeys` field keys. */
export function firstArray(payload: Record<string, unknown>, keys?: string[]): Record<string, unknown>[] | null {
  const ordered = keys
    ? [...keys.map((k) => payload[k]).filter(Array.isArray), ...Object.entries(payload).filter(([k, v]) => Array.isArray(v) && !ENVELOPE_KEYS.has(k)).map(([, v]) => v)]
    : Object.entries(payload).filter(([k, v]) => Array.isArray(v) && !ENVELOPE_KEYS.has(k)).map(([, v]) => v);
  for (const arr of ordered) {
    const items = (arr as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    // MCP content items ({type: "text"|"image"|"resource"}) are transport, not rows.
    if (items.length > 0 && items.every((it) => it.type === "text" || it.type === "image" || it.type === "resource")) continue;
    if (items.length > 0) return items;
  }
  return null;
}

type FieldMap = Partial<Record<"id" | "title" | "secondary" | "meta" | "status" | "avatar", string[]>>;

function pick(obj: Record<string, unknown>, keys: string[] | undefined): string | undefined {
  if (!keys) return undefined;
  for (const k of keys) {
    const v = obj[k] ?? obj[k.replace(/_/g, "")] ?? obj[k.replace(/_/g, "-")];
    if (v !== undefined && v !== null && typeof v !== "object") return String(v);
  }
  return undefined;
}

/**
 * Map a sniffed item array into list rows using a per-server field map.
 * Unknown fields degrade to a single line built from the first scalar values.
 */
function rowsFrom(items: Record<string, unknown>[], fm: FieldMap): ListRow[] {
  return items.map((item, i) => {
    const title = pick(item, fm.title) ?? headLines(JSON.stringify(item), 60);
    const secondary = pick(item, fm.secondary);
    const meta = pick(item, fm.meta);
    const status = pick(item, fm.status);
    const avatarLabel = pick(item, fm.avatar);
    const id = pick(item, fm.id) ?? String(i);
    return {
      id,
      primary: status ? `${status} · ${title}` : title,
      secondary,
      meta,
      avatar: avatarLabel ? { label: avatarLabel.slice(0, 2).toUpperCase() } : undefined,
    };
  });
}

/** Per-server hint tables: which array key and which fields map where. */
export const SERVER_HINTS: Record<string, { array?: string[]; fm: FieldMap; title: string }> = {
  github: {
    array: ["issues", "pull_requests", "items"],
    fm: { id: ["number", "id"], title: ["title"], secondary: ["body", "state_reason"], meta: ["created_at", "updated_at"], status: ["state"], avatar: ["user", "author"] },
    title: "GitHub",
  },
  notion: {
    array: ["results", "pages", "items"],
    fm: { id: ["id"], title: ["title", "name"], secondary: ["url", "object"], meta: ["last_edited_time", "updated_time"] },
    title: "Notion",
  },
  linear: {
    array: ["issues", "nodes", "items"],
    fm: { id: ["identifier", "key", "id"], title: ["title"], secondary: ["description"], meta: ["updatedAt", "updated_at"], status: ["state", "status"], avatar: ["assignee"] },
    title: "Linear",
  },
  jira: {
    array: ["issues", "items"],
    fm: { id: ["key", "id"], title: ["summary", "title"], secondary: ["description"], status: ["status"], avatar: ["assignee"] },
    title: "Jira",
  },
  airtable: {
    array: ["records", "items"],
    fm: { id: ["id"], title: ["name", "title", "Name"], secondary: ["description"], meta: ["createdTime"] },
    title: "Airtable",
  },
  hubspot: {
    array: ["results", "contacts", "deals", "items"],
    fm: { id: ["id"], title: ["name", "firstname", "dealname", "subject"], secondary: ["email", "domain"], meta: ["createdate", "updatedAt"] },
    title: "HubSpot",
  },
  salesforce: {
    array: ["records", "items"],
    fm: { id: ["Id", "id"], title: ["Name", "name", "Subject"], secondary: ["Email", "StageName"], meta: ["CreatedDate"] },
    title: "Salesforce",
  },
  stripe: {
    array: ["data", "payments", "invoices", "items"],
    fm: { id: ["id"], title: ["description", "customer_email", "customer"], meta: ["created", "date"], status: ["status"] },
    title: "Stripe",
  },
  discord: {
    array: ["messages", "items"],
    fm: { id: ["id"], title: ["content"], meta: ["timestamp"], avatar: ["author"] },
    title: "Discord",
  },
  zoom: {
    array: ["meetings", "items"],
    fm: { id: ["id"], title: ["topic", "title"], meta: ["start_time", "start"], status: ["status"] },
    title: "Zoom",
  },
  todoist: {
    array: ["items", "tasks"],
    fm: { id: ["id"], title: ["content", "title"], secondary: ["description"], meta: ["due"], status: ["priority"] },
    title: "Todoist",
  },
  trello: {
    array: ["cards", "items"],
    fm: { id: ["id"], title: ["name", "title"], secondary: ["desc"], meta: ["due"] },
    title: "Trello",
  },
  confluence: {
    array: ["results", "pages", "items"],
    fm: { id: ["id"], title: ["title"], secondary: ["url"] },
    title: "Confluence",
  },
  youtube: {
    array: ["items", "videos", "results"],
    fm: { id: ["videoId", "id"], title: ["title"], secondary: ["channelTitle", "channel"], meta: ["publishedAt", "viewCount"] },
    title: "YouTube",
  },
  sentry: {
    array: ["issues", "items"],
    fm: { id: ["shortId", "id"], title: ["title", "culprit"], meta: ["count", "firstSeen"], status: ["level"] },
    title: "Sentry",
  },
  figma: {
    array: ["files", "projects", "items"],
    fm: { id: ["key", "id"], title: ["name", "title"], meta: ["last_modified", "updated_at"] },
    title: "Figma",
  },
  spotify: {
    array: ["items", "tracks", "results"],
    fm: { id: ["id", "uri"], title: ["name", "title"], secondary: ["artist", "album"], meta: ["duration_ms"] },
    title: "Spotify",
  },
  filesystem: {
    array: ["files", "entries", "items"],
    fm: { id: ["path", "name"], title: ["name", "path"], meta: ["size", "modified"] },
    title: "Files",
  },
};

/** Generic list extraction driven by a hint table. */
export function fromHintList(part: ToolPartLike, server: string): ToolMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const hint = SERVER_HINTS[server];
  if (!hint) return null;
  const payload = payloadOf(part);
  if (!payload) return null;
  const items = firstArray(payload, hint.array);
  if (!items) return null;
  const rows = rowsFrom(items, hint.fm);
  if (rows.length === 0) return null;
  const list: ListCardMedia = {
    kind: "list-card",
    server,
    tool: part.tool,
    title: hint.title,
    rows,
    totalCount: typeof payload.total === "number" ? payload.total : rows.length,
    visibleCount: 8,
  };
  return list;
}

/** Register a hint entry at runtime (hosts and tests can extend coverage). */
export function registerHint(server: string, hint: (typeof SERVER_HINTS)[string]): void {
  SERVER_HINTS[server] = hint;
}

// ─── Table results (Sheets / Office / Postgres / Supabase / Airtable grids) ───

/** Extract a tabular result: payload carries { columns | headers, rows | values }. */
export function fromTableResult(part: ToolPartLike, server: string, title: string): TableCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const payload = payloadOf(part);
  if (!payload) return null;
  const rawCols = payload.columns ?? payload.headers ?? payload.fields;
  const rawRows = payload.rows ?? payload.values ?? payload.records;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

  let columns: string[];
  let rows: string[][];
  if (Array.isArray(rawCols) && rawCols.every((c) => typeof c === "string")) {
    columns = rawCols as string[];
    rows = rawRows.map((r) => (Array.isArray(r) ? r.map(cellToString) : objectToCells(r as Record<string, unknown>, columns)));
  } else {
    // array of objects without a header list — derive columns from first row
    const first = rawRows[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      columns = Object.keys(first as Record<string, unknown>);
      rows = rawRows.map((r) => objectToCells(r as Record<string, unknown>, columns));
    } else {
      columns = ["Value"];
      rows = rawRows.map((r) => [cellToString(r)]);
    }
  }
  if (columns.length === 0 || rows.length === 0) return null;
  return {
    kind: "table-card",
    server,
    tool: part.tool,
    title,
    columns,
    rows,
    visibleRows: 20,
    totalRows: rows.length,
  };
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function objectToCells(obj: Record<string, unknown>, columns: string[]): string[] {
  return columns.map((c) => cellToString(obj[c]));
}

// ─── Stat results (balances, productivity, sprint summaries) ───

/** Extract a stat-strip when the payload is a flat object of numeric scalars. */
export function fromStatStrip(part: ToolPartLike, server: string, title: string): StatStripMedia | null {
  if (part.state.status !== "completed") return null;
  const payload = payloadOf(part);
  if (!payload) return null;
  const entries = Object.entries(payload).filter(([, v]) => typeof v === "number" || typeof v === "string");
  const numeric = entries.filter(([, v]) => typeof v === "number");
  if (numeric.length < 2 || entries.length > 12) return null;
  return {
    kind: "stat-strip",
    server,
    tool: part.tool,
    title,
    stats: entries.slice(0, 4).map(([k, v], i) => ({
      value: String(v),
      label: k.replace(/_/g, " "),
      accent: i === 0,
    })),
  };
}

// The dispatch table: (server, tool) → extractor. Hosts may extend or
// override entries; anything unmatched falls through the generic chain.

import type { ToolMedia, ToolPartLike } from "./types.js";
import {
  fromBash,
  fromDiff,
  fromJsonFallback,
  fromMcp,
  fromRead,
  fromUiResource,
  fromVideoGen,
  fromWebFetch,
  fromWebSearch,
  fromWriteOrEdit,
} from "./extract/generic.js";
import { fromNotesEnvelope, fromTasksEnvelope } from "./extract/connectors.js";
import {
  fromCalendarAgenda,
  fromDriveList,
  fromGmailDetail,
  fromGmailEditor,
  fromGmailList,
  fromGmailSendConfirm,
  fromSlackThread,
} from "./extract/connectors.js";

export type Extractor = (part: ToolPartLike) => ToolMedia | null;

/** Builtin tool-name extractors (exact tool ids). */
export const BUILTIN_EXTRACTORS: Record<string, Extractor> = {
  read: fromRead,
  websearch: fromWebSearch,
  websearch_cited: fromWebSearch,
  webfetch: fromWebFetch,
  bash: fromBash,
  write: fromWriteOrEdit,
  edit: fromDiff,
  "video-gen": fromVideoGen,
};

/** MCP server extractors: keyed by server prefix, tried before the generic mcp-result. */
export const SERVER_EXTRACTORS: Record<string, Record<string, Extractor>> = {
  gmail: {
    list_emails: fromGmailList,
    search_emails: fromGmailList,
    read_email: fromGmailDetail,
    draft_email: fromGmailEditor,
    reply_email: fromGmailEditor,
    send_email: fromGmailSendConfirm,
  },
  "google-calendar": {
    list_events: fromCalendarAgenda,
    search_events: fromCalendarAgenda,
  },
  "google-drive": {
    search_files: fromDriveList,
    list_files: fromDriveList,
  },
  slack: {
    channel_history: fromSlackThread,
    get_thread: fromSlackThread,
    search_messages: fromSlackThread,
  },
};

// ─── Family envelopes (kind-scoped, not tool-name-scoped) ───

function tryEnvelopes(part: ToolPartLike): ToolMedia | null {
  return fromNotesEnvelope(part) ?? fromTasksEnvelope(part);
}

/**
 * Extract a ToolMedia descriptor from a tool-call Part.
 *
 * Resolution order:
 *  1. Family envelopes (the notes/tasks kinds — keyed on the kind field in metadata).
 *  2. Exact builtin tool ids (read/websearch/bash and friends).
 *  3. Server-specific connector extractors (gmail, google-calendar, google-drive, slack).
 *  4. Host overrides (checked FIRST when provided, so a host can re-route any id).
 *  5. Generic MCP envelope, then the JSON fallback.
 *
 * Returns null for running/pending parts (except the family envelopes,
 * which gate on completed themselves) — hosts show their own running state.
 */
export function extractToolMedia(
  part: ToolPartLike,
  customExtractors?: Record<string, Extractor>,
): ToolMedia | null {
  if (customExtractors) {
    const custom = customExtractors[part.tool];
    if (custom) {
      const hit = custom(part);
      if (hit) return hit;
    }
  }

  const enveloped = tryEnvelopes(part);
  if (enveloped) return enveloped;

  const builtin = BUILTIN_EXTRACTORS[part.tool];
  if (builtin) return builtin(part);

  // Server-prefixed id ({server}_{tool}) → try the server's extractor table.
  const idx = part.tool.indexOf("_");
  if (idx > 0) {
    const server = part.tool.slice(0, idx);
    const rawTool = part.tool.slice(idx + 1);
    const serverTable = SERVER_EXTRACTORS[server];
    if (serverTable) {
      const hit = serverTable[rawTool];
      if (hit) return hit(part);
    }
  }

  // MCP Apps interop: a tool carrying a ui:// UIResource renders as a
  // sandboxed iframe (server-authored UI) — checked before the generic
  // envelope so an Apps-enabled server's tool wins over mcp-result JSON.
  const ui = fromUiResource(part);
  if (ui) return ui;

  return fromMcp(part) ?? fromJsonFallback(part);
}

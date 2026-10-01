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
import {
  fromAppleApps,
  fromImageGen,
  fromMetaTool,
  fromOffice,
  fromStandaloneScreenshot,
  fromTrackerEnvelope,
} from "./extract/firstparty.js";
import { fromHintList, fromTableResult } from "./extract/lists.js";
import {
  fromNotesEnvelope,
  fromTasksEnvelope,
} from "./extract/connectors.js";
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
  "image-gen": fromImageGen,
  "video-gen": fromVideoGen,
  // native meta tools
  tool_search: fromMetaTool,
  compact: fromMetaTool,
  send_message: fromMetaTool,
  list_peers: fromMetaTool,
  // tracker families (bare ids; the tracker_* cluster is server-matched below)
  tracker: fromTrackerEnvelope,
  dev_board: fromTrackerEnvelope,
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
  "computer-use": {
    // standalone single-result screenshots (grouped runs use the activity
    // strip builder instead)
    screenshot: fromStandaloneScreenshot,
    zoom: fromStandaloneScreenshot,
  },
  tracker: {
    create_card: fromTrackerEnvelope,
    update_card: fromTrackerEnvelope,
    move_card: fromTrackerEnvelope,
    find_cards: fromTrackerEnvelope,
    get_card: fromTrackerEnvelope,
    add_comment: fromTrackerEnvelope,
    archive_card: fromTrackerEnvelope,
    restore_card: fromTrackerEnvelope,
    delete_card: fromTrackerEnvelope,
  },
  "apple-apps": {
    calendar_list_events: fromAppleApps,
    calendar_create_event: fromAppleApps,
    reminders_list: fromAppleApps,
    reminders_create: fromAppleApps,
    mail_list_mailboxes: fromAppleApps,
    mail_list_messages: fromAppleApps,
    mail_read_message: fromAppleApps,
    mail_search: fromAppleApps,
    mail_compose: fromAppleApps,
    notes_list: fromAppleApps,
    notes_search: fromAppleApps,
    notes_create: fromAppleApps,
  },
  office: {
    sheet_create: fromOffice,
    sheet_read: fromOffice,
    doc_create: fromOffice,
    slides_create: fromOffice,
  },
  // ─── Tier-3 connectors: generic hint-table lists ───
  github: { list_issues: hint("github"), search_issues: hint("github"), list_pull_requests: hint("github") },
  notion: { search: hint("notion"), get_page: hint("notion") },
  linear: { list_issues: hint("linear"), search_issues: hint("linear") },
  jira: { search_issues: hint("jira"), list_issues: hint("jira") },
  confluence: { search: hint("confluence"), list_pages: hint("confluence") },
  airtable: { list_records: hint("airtable"), query: hint("airtable") },
  hubspot: { search_contacts: hint("hubspot"), list_deals: hint("hubspot"), search_deals: hint("hubspot") },
  salesforce: { query: hint("salesforce"), search_records: hint("salesforce") },
  stripe: { list_payments: hint("stripe"), list_invoices: hint("stripe") },
  discord: { read_messages: hint("discord"), list_messages: hint("discord") },
  zoom: { list_meetings: hint("zoom") },
  todoist: { list_tasks: hint("todoist") },
  trello: { list_cards: hint("trello"), get_card: hint("trello") },
  youtube: { search: hint("youtube") },
  sentry: { list_issues: hint("sentry") },
  figma: { list_files: hint("figma"), list_projects: hint("figma") },
  spotify: { search: hint("spotify"), list_tracks: hint("spotify") },
  filesystem: { list: hint("filesystem"), ls: hint("filesystem") },
  whatsapp: { messages: hint("discord"), chats: hint("discord") },
  telegram: { messages: hint("discord"), chats: hint("discord") },
  docker: { ps: hint("docker"), list_containers: hint("docker"), list_pods: hint("docker") },
  kubernetes: { list_pods: hint("docker"), get_pods: hint("docker") },
  "aws-s3": { list_buckets: hint("filesystem"), list_objects: hint("filesystem") },
  s3: { list_buckets: hint("filesystem"), list_objects: hint("filesystem") },
  googlemaps: { search_places: hint("notion"), geocode: hint("notion") },
  zapier: { run_status: hint("github"), list_runs: hint("github") },
  make: { run_status: hint("github"), list_runs: hint("github") },
  // ─── Tabular servers ───
  "google-sheets": { read_sheet: table("google-sheets", "Sheet"), get_values: table("google-sheets", "Sheet") },
  postgres: { query: table("postgres", "Query result") },
  postgresql: { query: table("postgres", "Query result") },
  supabase: { query: table("supabase", "Query result"), list_records: table("supabase", "Records") },
};

/** Hint-table extractor bound to its server name. */
function hint(server: string): Extractor {
  return (part) => fromHintList(part, server);
}

/** Table extractor bound to a server + title. */
function table(server: string, title: string): Extractor {
  return (part) => fromTableResult(part, server, title);
}

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

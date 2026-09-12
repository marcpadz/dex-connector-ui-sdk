// dex-connector-ui-sdk — core types.
//
// The ToolMedia descriptor union is the entire contract between the
// extractors (pure, shipped here) and the renderer (host-owned). Hosts map
// each kind onto their own component vocabulary; the SDK never renders.

/** Minimal shape of a tool-call Part any harness must provide. Structurally
 *  compatible with Dextop's ToolPart; adopters adapt their own part type. */
export interface ToolPartLike {
  tool: string;
  state: {
    status: "running" | "pending" | "completed" | "error";
    input: Record<string, unknown>;
    output?: unknown;
    metadata?: Record<string, unknown> | null;
    title?: string;
  };
}

/** A minimal message-Part shape for activity grouping (reasoning + tool). */
export type ActivityPartLike =
  | ({ type: "reasoning"; text?: string } & Record<string, unknown>)
  | ({ type: "tool" } & ToolPartLike);

// ─── Generic media kinds (host-independent) ───

export interface ImageMedia {
  kind: "image";
  url: string;
  alt: string;
  caption?: string;
}

export interface SvgMedia {
  kind: "svg";
  content: string;
  title: string;
  filePath?: string;
}

export interface HtmlMedia {
  kind: "html";
  content: string;
  title: string;
  filePath?: string;
}

export interface VideoMedia {
  kind: "video";
  url: string;
  title?: string;
}

export interface CodeMedia {
  kind: "code";
  language: string;
  content: string;
  title: string;
  filePath?: string;
}

export interface DiffMedia {
  kind: "diff";
  content: string;
  title: string;
  additions: number;
  deletions: number;
}

export interface MarkdownMedia {
  kind: "markdown";
  content: string;
  title: string;
  filePath?: string;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchResultsMedia {
  kind: "search-results";
  query: string;
  results: SearchResult[];
}

export interface FetchMedia {
  kind: "fetch";
  url: string;
  title: string;
  excerpt: string;
}

export interface BashOutputMedia {
  kind: "bash-output";
  stdout: string;
  stderr: string;
  rc: number | null;
}

export interface FileReadMedia {
  kind: "file-read";
  path: string;
  excerpt: string;
  lines: number;
}

export interface McpContentItem {
  type: "text" | "image" | "resource";
  text?: string;
  uri?: string | null;
  mime_type?: string;
}

export interface McpResultMedia {
  kind: "mcp-result";
  server: string;
  tool: string;
  args: Record<string, unknown>;
  content: McpContentItem[];
  itemCount: number;
}

export interface JsonMedia {
  kind: "json";
  title: string;
  content: string;
}

export interface BrowserSelectionMedia {
  kind: "browser-selection";
  url: string;
  selector: string;
  xpath: string;
  outer_html: string;
  screenshot?: string;
  label?: string;
}

/**
 * MCP Apps / MCP-UI interop channel (SEP-1865). When a tool result carries a
 * `ui://` UIResource, the host renders it in a SANDBOXED IFRAME inside the
 * standard card chrome — the one case where the server authors the UI.
 * Prefer host-owned descriptors (list-card, detail-card, …) whenever a
 * connector's result shape is known; this kind is the fallback that makes
 * third-party MCP Apps servers "just work".
 */
export interface UiResourceMedia {
  kind: "ui-resource";
  server: string;
  tool: string;
  /** `ui://` resource URI — the host resolves it via resources/read when no html is inlined. */
  resourceUri: string;
  /** Pre-delivered HTML (MCP-UI inlines the document in the resource text/blob). */
  html?: string;
  /** e.g. "text/html;profile=mcp-apps" */
  mimeType?: string;
  /** SEP-1865 CSP directives from `_meta.ui.csp` (e.g. connectDomains, frameDomains). */
  csp?: Record<string, string[]>;
}

// ─── First-party family kinds ───

/** One frame in a Computer Use / Browser activity strip. */
export type ActivityFrame =
  | {
      type: "screenshot";
      tool: string;
      imageUrl: string | null;
      /** The agent reasoning that immediately preceded this capture. */
      reasoning: string | null;
      windowId: number | null;
      family: ActivityFamily;
    }
  | {
      type: "action";
      tool: string;
      label: string;
      icon: string;
      family: ActivityFamily;
    }
  | {
      type: "thought";
      text: string;
      family: ActivityFamily;
    };

export type ActivityFamily = "computer-use" | "browser";

export interface ActivityStripMedia {
  kind: "activity-strip";
  family: ActivityFamily;
  frames: ActivityFrame[];
  steps: number;
}

/** Notes envelope (Dextop notes_* contract). */
export interface NotesEnvelopeMedia {
  kind: "notes-envelope";
  action: string;
  count?: number;
  query?: string;
  notes?: Array<{ path: string; title: string; folder?: string; tags: string[]; snippet?: string; time_updated: string }>;
  note?: { path: string; title: string; content?: string; folder?: string; tags: string[]; time_updated: string };
  folders?: Array<{ name: string; note_count: number }>;
}

/** Tasks envelope (Dextop tasks_* contract). */
export interface TaskSummary {
  id: string;
  title: string;
  description?: string;
  status: string;
  ticket_key?: string;
  board_name?: string;
  assignee_display?: string;
  workspace_path?: string;
}

export interface TasksEnvelopeMedia {
  kind: "tasks-envelope";
  action: string;
  count?: number;
  tasks?: TaskSummary[];
  task?: TaskSummary;
}

// ─── §3 primitive kinds (connector-card vocabulary) ───
// Connector extractors may emit these directly when no bespoke kind exists —
// the host renders them with its own ListCard/EditorCard/… implementations.

export interface ListRow {
  id: string;
  /** Primary line (e.g. sender + subject). */
  primary: string;
  /** Secondary line (e.g. snippet). */
  secondary?: string;
  /** Trailing meta (e.g. relative time). */
  meta?: string;
  /** Unread / attention dot. */
  unread?: boolean;
  /** Attachment glyph count. */
  attachments?: number;
  avatar?: { label: string; color?: string; image_url?: string };
  chips?: string[];
}

export interface ListCardMedia {
  kind: "list-card";
  server: string;
  tool: string;
  title: string;
  groups?: Array<{ label: string; rows: ListRow[] }>;
  rows?: ListRow[];
  totalCount: number;
  /** Rows shown inline before a "show N more" footer. */
  visibleCount?: number;
}

export interface DetailCardMedia {
  kind: "detail-card";
  server: string;
  tool: string;
  title: string;
  subtitle?: string;
  /** Ordered field grid: label → plain-text value. */
  fields?: Array<{ label: string; value: string }>;
  /** Clamped body text (e.g. email body). */
  body?: string;
  attachments?: Array<{ name: string; size?: string }>;
}

export interface EditorField {
  label: string;
  /** control hint for the host renderer */
  control: "chips" | "text" | "textarea" | "select" | "date" | "attachments" | "custom";
  value?: unknown;
  placeholder?: string;
  required?: boolean;
}

export interface EditorCardMedia {
  kind: "editor-card";
  server: string;
  tool: string;
  title: string;
  /** Primary action label (e.g. "Send"). Submit is ALWAYS user-initiated. */
  primaryAction: string;
  secondaryAction?: string;
  fields: EditorField[];
  /** Sign-off selector options (Gmail editor contract). */
  signOffs?: string[];
}

export interface ConfirmCardMedia {
  kind: "confirm-card";
  server: string;
  tool: string;
  /** Banner, e.g. "Dex wants to send this email now". */
  banner: string;
  destructive?: boolean;
  fields?: Array<{ label: string; value: string }>;
  bodyPreview?: string;
}

// ─── The full union ───

export type ToolMedia =
  | ImageMedia
  | SvgMedia
  | HtmlMedia
  | VideoMedia
  | CodeMedia
  | DiffMedia
  | MarkdownMedia
  | SearchResultsMedia
  | FetchMedia
  | BashOutputMedia
  | FileReadMedia
  | McpResultMedia
  | JsonMedia
  | BrowserSelectionMedia
  | UiResourceMedia
  | ActivityStripMedia
  | NotesEnvelopeMedia
  | TasksEnvelopeMedia
  | ListCardMedia
  | DetailCardMedia
  | EditorCardMedia
  | ConfirmCardMedia;

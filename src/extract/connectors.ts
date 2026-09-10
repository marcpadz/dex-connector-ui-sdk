// Notes + Tasks envelope parsers (Dextop notes_* / tasks_* contracts) and
// connector result extractors for Gmail / Calendar / Drive / Slack.
//
// Connector extractors parse the RESULT SHAPES defined in the MCP inline UI
// handover report (docs/plans/2026-09-06-mcp-inline-ui-handover.md §5) and
// emit §3 primitive descriptors (list-card / detail-card / editor-card /
// confirm-card). They are contract-first: they return null on any mismatch so
// the dispatch falls back to the generic mcp-result render.

import type {
  ConfirmCardMedia,
  DetailCardMedia,
  EditorCardMedia,
  ListCardMedia,
  ListRow,
  NotesEnvelopeMedia,
  TaskSummary,
  TasksEnvelopeMedia,
  ToolMedia,
  ToolPartLike,
} from "../types.js";
import { asString, isRunning, partMetadata } from "./helpers.js";

// ─── Envelope plumbing ───

function parseEnvelope<T extends { kind: string; action: string }>(
  part: ToolPartLike,
  kind: string,
): T | null {
  if (part.state.status !== "completed") return null;
  let data: unknown = part.state.metadata;
  if (!data && typeof part.state.output === "string") {
    try {
      data = JSON.parse(part.state.output);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.kind !== kind || typeof record.action !== "string") return null;
  return record as unknown as T;
}

// ─── Notes ───

interface RawNotesEnvelope {
  kind: "notes";
  action: string;
  count?: number;
  query?: string;
  notes?: Array<Record<string, unknown>>;
  note?: Record<string, unknown>;
  folders?: Array<Record<string, unknown>>;
}

export function fromNotesEnvelope(part: ToolPartLike): NotesEnvelopeMedia | null {
  const env = parseEnvelope<RawNotesEnvelope>(part, "notes");
  if (!env) return null;

  const notes = (env.notes ?? []).map((n) => ({
    path: asString(n.path) ?? "",
    title: asString(n.title) ?? "",
    folder: asString(n.folder),
    tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
    snippet: asString(n.snippet),
    time_updated: asString(n.time_updated) ?? asString(n.timeUpdated) ?? "",
  }));
  const noteRaw = env.note;
  const note = noteRaw
    ? {
        path: asString(noteRaw.path) ?? "",
        title: asString(noteRaw.title) ?? "",
        content: asString(noteRaw.content),
        folder: asString(noteRaw.folder),
        tags: Array.isArray(noteRaw.tags) ? (noteRaw.tags as string[]) : [],
        time_updated: asString(noteRaw.time_updated) ?? asString(noteRaw.timeUpdated) ?? "",
      }
    : undefined;
  const folders = (env.folders ?? []).map((f) => ({
    name: asString(f.name) ?? "",
    note_count: typeof f.note_count === "number" ? f.note_count : 0,
  }));

  return { kind: "notes-envelope", action: env.action, count: env.count, query: env.query, notes, note, folders };
}

// ─── Tasks ───

interface RawTasksEnvelope {
  kind: "tasks";
  action: string;
  count?: number;
  tasks?: Array<Record<string, unknown>>;
  task?: Record<string, unknown>;
}

function mapTask(t: Record<string, unknown>): TaskSummary {
  return {
    id: asString(t.id) ?? "",
    title: asString(t.title) ?? "",
    description: asString(t.description),
    status: asString(t.status) ?? "not_started",
    ticket_key: asString(t.ticket_key),
    board_name: asString(t.board_name),
    assignee_display: asString(t.assignee_display),
    workspace_path: asString(t.workspace_path),
  };
}

export function fromTasksEnvelope(part: ToolPartLike): TasksEnvelopeMedia | null {
  const env = parseEnvelope<RawTasksEnvelope>(part, "tasks");
  if (!env) return null;
  return {
    kind: "tasks-envelope",
    action: env.action,
    count: env.count,
    tasks: (env.tasks ?? []).map(mapTask),
    task: env.task ? mapTask(env.task) : undefined,
  };
}

// ─── Gmail ───
// Result shape per report §5.1: the tool result (metadata or JSON output)
// carries { messages: [...] } for list/search, { message: {...} } for read,
// { draft: {...} } for draft/reply.

interface RawEmail {
  id?: string;
  from_name?: string;
  from_email?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  time?: string;
  unread?: boolean;
  attachments?: Array<{ name: string; size?: string }>;
  to?: string[];
}

function parseGmailPayload(part: ToolPartLike): Record<string, unknown> | null {
  const metadata = partMetadata(part);
  if (metadata.messages || metadata.message || metadata.draft) return metadata;
  if (typeof part.state.output === "string") {
    try {
      const parsed = JSON.parse(part.state.output) as Record<string, unknown>;
      if (parsed.messages || parsed.message || parsed.draft) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function mapEmailRow(e: RawEmail): ListRow {
  return {
    id: e.id ?? "",
    primary: [e.from_name ?? e.from_email ?? "", e.subject ?? ""].filter(Boolean).join(" — "),
    secondary: e.snippet,
    meta: e.time,
    unread: e.unread,
    attachments: e.attachments?.length,
    avatar: { label: (e.from_name ?? e.from_email ?? "?").slice(0, 2).toUpperCase() },
  };
}

export function fromGmailList(part: ToolPartLike): ListCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const payload = parseGmailPayload(part);
  if (!payload || !Array.isArray(payload.messages)) return null;
  const messages = payload.messages as RawEmail[];
  return {
    kind: "list-card",
    server: "gmail",
    tool: part.tool,
    title: "Gmail",
    rows: messages.map(mapEmailRow),
    totalCount: typeof payload.total === "number" ? payload.total : messages.length,
    visibleCount: 8,
  };
}

export function fromGmailDetail(part: ToolPartLike): DetailCardMedia | null {
  if (part.state.status !== "completed") return null;
  const payload = parseGmailPayload(part);
  const raw = (payload?.message ?? payload?.draft) as RawEmail | undefined;
  if (!raw) return null;
  return {
    kind: "detail-card",
    server: "gmail",
    tool: part.tool,
    title: raw.subject ?? "(no subject)",
    subtitle: [raw.from_name, raw.from_email].filter(Boolean).join(" · "),
    fields: [{ label: "To", value: (raw.to ?? []).join(", ") }],
    body: raw.body ?? raw.snippet,
    attachments: raw.attachments,
  };
}

export function fromGmailEditor(part: ToolPartLike): EditorCardMedia | null {
  if (part.state.status !== "completed") return null;
  const payload = parseGmailPayload(part);
  const raw = (payload?.draft ?? payload?.message) as RawEmail | undefined;
  if (!raw) return null;
  return {
    kind: "editor-card",
    server: "gmail",
    tool: part.tool,
    title: "Gmail",
    primaryAction: "Send",
    secondaryAction: "Save draft",
    fields: [
      { label: "To", control: "chips", value: raw.to ?? [], placeholder: "add recipient…" },
      { label: "Subject", control: "text", value: raw.subject ?? "", required: true },
      { label: "Body", control: "textarea", value: raw.body ?? "" },
      { label: "Attachments", control: "attachments", value: raw.attachments ?? [] },
    ],
    signOffs: ["Best, Marc", "Thanks! — Marc", "Regards, Marc Adrian"],
  };
}

export function fromGmailSendConfirm(part: ToolPartLike): ConfirmCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const input = part.state.input;
  const to = Array.isArray(input.to) ? (input.to as string[]) : typeof input.to === "string" ? [input.to] : [];
  const subject = asString(input.subject);
  const body = asString(input.body);
  if (!to.length && !subject) return null;
  return {
    kind: "confirm-card",
    server: "gmail",
    tool: part.tool,
    banner: "Dex wants to send this email now — review before confirming.",
    fields: [
      { label: "To", value: to.join(", ") },
      { label: "Subject", value: subject ?? "" },
    ],
    bodyPreview: body,
  };
}

// ─── Google Calendar ───

interface RawEvent {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  guests?: Array<{ name?: string; email?: string; status?: string }>;
  all_day?: boolean;
  recurring?: boolean;
}

function eventDayLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function eventTimeLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function fromCalendarAgenda(part: ToolPartLike): ListCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const metadata = partMetadata(part);
  let events = metadata.events;
  if (!Array.isArray(events) && typeof part.state.output === "string") {
    try {
      events = (JSON.parse(part.state.output) as Record<string, unknown>).events;
    } catch {
      events = undefined;
    }
  }
  if (!Array.isArray(events)) return null;

  const byDay = new Map<string, ListRow[]>();
  for (const e of events as RawEvent[]) {
    const day = eventDayLabel(e.start) || "Unscheduled";
    const timeRange = e.all_day ? "all-day" : [eventTimeLabel(e.start), eventTimeLabel(e.end)].filter(Boolean).join("–");
    const row: ListRow = {
      id: e.id ?? "",
      primary: `${timeRange}  ${e.title ?? ""}`.trim(),
      secondary: e.location,
      chips: [e.recurring ? "↻ recurring" : "", e.guests?.length ? `${e.guests.length} guests` : ""].filter(Boolean),
    };
    const list = byDay.get(day) ?? [];
    list.push(row);
    byDay.set(day, list);
  }

  return {
    kind: "list-card",
    server: "google-calendar",
    tool: part.tool,
    title: "Calendar",
    groups: [...byDay.entries()].map(([label, rows]) => ({ label, rows })),
    totalCount: events.length,
  };
}

// ─── Google Drive ───

interface RawFile {
  id?: string;
  name?: string;
  mime_type?: string;
  kind?: "folder" | "file";
  size?: string;
  modified?: string;
  owners?: Array<{ name?: string }>;
  shared_with?: Array<{ name?: string }>;
}

export function fromDriveList(part: ToolPartLike): ListCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const metadata = partMetadata(part);
  let files = metadata.files;
  if (!Array.isArray(files) && typeof part.state.output === "string") {
    try {
      files = (JSON.parse(part.state.output) as Record<string, unknown>).files;
    } catch {
      files = undefined;
    }
  }
  if (!Array.isArray(files)) return null;

  const rows = (files as RawFile[]).map((f) => ({
    id: f.id ?? "",
    primary: f.name ?? "",
    secondary: [f.size, f.modified ? `edited ${f.modified}` : "", f.shared_with?.length ? `shared with ${f.shared_with.length}` : ""].filter(Boolean).join(" · "),
    chips: [f.kind === "folder" ? "folder" : f.mime_type ?? ""].filter(Boolean),
  }));

  return {
    kind: "list-card",
    server: "google-drive",
    tool: part.tool,
    title: "Drive",
    rows,
    totalCount: rows.length,
    visibleCount: 8,
  };
}

// ─── Slack ───

interface RawSlackMessage {
  ts?: string;
  user_name?: string;
  user_id?: string;
  text?: string;
  reactions?: Array<{ emoji: string; count: number }>;
  reply_count?: number;
}

export function fromSlackThread(part: ToolPartLike): ListCardMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const metadata = partMetadata(part);
  let messages = metadata.messages;
  if (!Array.isArray(messages) && typeof part.state.output === "string") {
    try {
      messages = (JSON.parse(part.state.output) as Record<string, unknown>).messages;
    } catch {
      messages = undefined;
    }
  }
  if (!Array.isArray(messages)) return null;

  const channel = asString(metadata.channel) ?? asString(part.state.input.channel) ?? "";
  const rows = (messages as RawSlackMessage[]).map((m) => ({
    id: m.ts ?? "",
    primary: `${m.user_name ?? m.user_id ?? "?"}: ${m.text ?? ""}`.slice(0, 200),
    meta: m.ts,
    chips: [
      m.reply_count ? `${m.reply_count} replies` : "",
      ...(m.reactions ?? []).map((r) => `${r.emoji} ${r.count}`),
    ].filter(Boolean),
  }));

  return {
    kind: "list-card",
    server: "slack",
    tool: part.tool,
    title: channel ? `Slack · ${channel}` : "Slack",
    rows,
    totalCount: rows.length,
    visibleCount: 10,
  };
}

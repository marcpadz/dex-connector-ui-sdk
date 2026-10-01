// First-party gap extractors (v0.2): image-gen, computer-use standalone
// screenshots, tracker/dev_board envelope, Apple Apps polyglot, Office, and
// the native meta tools. Contract-first: null on mismatch, never throw.

import type {
  ConfirmCardMedia,
  DetailCardMedia,
  ImageMedia,
  ListCardMedia,
  TableCardMedia,
  ToolMedia,
  ToolPartLike,
  TrackerEnvelopeMedia,
} from "../types.js";
import { asString, isRunning, partMetadata } from "./helpers.js";
import { firstArray, fromTableResult, payloadOf } from "./lists.js";

// ─── image-gen / video-gen media ───

/** Extract a generated image: metadata.image_data_url (computer-use contract),
 *  metadata.url, or a bare/JSON-wrapped URL in output. */
export function fromImageGen(part: ToolPartLike): ImageMedia | null {
  if (part.state.status !== "completed") return null;
  const metadata = partMetadata(part);
  const dataUrl = asString(metadata.image_data_url);
  if (dataUrl) return { kind: "image", url: dataUrl, alt: asString(metadata.prompt) ?? "Generated image", caption: "Generated image" };
  let url = asString(metadata.url ?? metadata.image_url ?? metadata.imageUrl);
  if (!url) {
    const out = asString(part.state.output);
    if (out) {
      try {
        const parsed = JSON.parse(out) as Record<string, unknown>;
        url = asString(parsed.url ?? parsed.image_url ?? parsed.imageDataUrl);
      } catch {
        url = out.startsWith("http") || out.startsWith("data:") ? out : undefined;
      }
    }
  }
  if (!url) return null;
  return { kind: "image", url, alt: asString(metadata.prompt) ?? asString(part.state.title) ?? "Generated image", caption: asString(metadata.prompt) ?? "Generated image" };
}

// ─── computer-use / browser-hand standalone screenshot parts ───

/** Single screenshot part → image (the activity-strip builder covers grouped
 *  runs; this covers the standalone result card). */
export function fromStandaloneScreenshot(part: ToolPartLike): ImageMedia | null {
  if (isRunning(part)) return null;
  const { imageUrl } = extractShotUrl(part);
  if (!imageUrl) return null;
  return { kind: "image", url: imageUrl, alt: part.tool, caption: part.tool };
}

function extractShotUrl(part: ToolPartLike): { imageUrl: string | null } {
  const metadata = partMetadata(part);
  const direct = asString(metadata.image_data_url);
  if (direct) return { imageUrl: direct };
  const output = part.state.output;
  if (typeof output === "string") {
    let parsed: unknown = null;
    try { parsed = JSON.parse(output); } catch { parsed = null; }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const img = typeof obj.image === "string" ? obj.image : null;
      if (img) {
        const mime = asString(obj.mime) ?? asString(obj.mime_type) ?? "image/png";
        return { imageUrl: img.startsWith("data:") ? img : `data:${mime};base64,${img}` };
      }
      const content = obj.content;
      if (Array.isArray(content)) {
        for (const item of content as unknown[]) {
          if (item && typeof item === "object" && (item as Record<string, unknown>).type === "image") {
            const o = item as Record<string, unknown>;
            if (typeof o.data === "string") {
              const mime = asString(o.mimeType) ?? asString(o.mime_type) ?? "image/png";
              return { imageUrl: o.data.startsWith("data:") ? o.data : `data:${mime};base64,${o.data}` };
            }
          }
        }
      }
    }
  }
  if (Array.isArray(metadata.mcp_content)) {
    for (const item of metadata.mcp_content as unknown[]) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "image") {
        const o = item as Record<string, unknown>;
        if (typeof o.data === "string") {
          const mime = asString(o.mimeType) ?? asString(o.mime_type) ?? "image/png";
          return { imageUrl: o.data.startsWith("data:") ? o.data : `data:${mime};base64,${o.data}` };
        }
      }
    }
  }
  return { imageUrl: null };
}

// ─── Tracker / dev_board envelope ───

interface RawTracker {
  action?: string;
  tickets?: Array<Record<string, unknown>>;
  ticket?: Record<string, unknown>;
  error?: unknown;
}

function mapTicket(t: Record<string, unknown>): TrackerEnvelopeMedia["tickets"][number] {
  return {
    key: asString(t.key ?? t.ticket_key ?? t.id),
    title: asString(t.title ?? t.name) ?? "",
    status: asString(t.status ?? t.column),
    assignee: asString(t.assignee),
    column: asString(t.column ?? t.status),
  };
}

/** Tracker envelope: { action, tickets | ticket } in metadata or JSON output. */
export function fromTrackerEnvelope(part: ToolPartLike): TrackerEnvelopeMedia | null {
  if (part.state.status !== "completed") return null;
  const payload = payloadOf(part);
  if (!payload) return null;
  const raw = payload as RawTracker;
  if (typeof raw.action !== "string" || raw.error) return null;
  const tickets = [...(Array.isArray(raw.tickets) ? raw.tickets.map(mapTicket) : []), ...(raw.ticket ? [mapTicket(raw.ticket)] : [])];
  if (tickets.length === 0 && raw.action !== "delete") return null;
  return {
    kind: "tracker-envelope",
    server: part.tool.startsWith("dev_board") ? "dev_board" : "tracker",
    action: raw.action,
    tickets,
  };
}

// ─── Apple Apps polyglot ───

/** Apple Apps results sniff their payload: {events} → agenda rows,
 *  {reminders} → checklist rows, {messages} → mail rows, single message → detail. */
export function fromAppleApps(part: ToolPartLike): ToolMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  const payload = payloadOf(part);
  if (!payload) return null;

  if (Array.isArray(payload.events)) {
    const rows = (payload.events as Record<string, unknown>[]).map((e, i) => ({
      id: asString(e.id) ?? String(i),
      primary: `${asString(e.title) ?? "Event"} — ${asString(e.start) ?? ""}`.trim(),
      secondary: asString(e.calendar),
      chips: [asString(e.notes) ? "notes" : ""].filter(Boolean),
    }));
    return list("apple-apps", part.tool, "Calendar", rows);
  }
  if (Array.isArray(payload.reminders)) {
    const rows = (payload.reminders as Record<string, unknown>[]).map((r, i) => ({
      id: asString(r.id) ?? String(i),
      primary: asString(r.title ?? r.name) ?? "Reminder",
      secondary: asString(r.notes),
      meta: asString(r.due_date ?? r.dueDate),
      unread: r.completed === false,
    }));
    return list("apple-apps", part.tool, "Reminders", rows);
  }
  if (Array.isArray(payload.messages)) {
    const rows = (payload.messages as Record<string, unknown>[]).map((m, i) => ({
      id: asString(m.id ?? m.message_id) ?? String(i),
      primary: [asString(m.sender ?? m.from), asString(m.subject)].filter(Boolean).join(" — "),
      secondary: asString(m.snippet ?? m.body),
      meta: asString(m.date ?? m.time_received),
    }));
    return list("apple-apps", part.tool, "Mail", rows);
  }
  const single = payload.message ?? payload.draft;
  if (single && typeof single === "object") {
    const m = single as Record<string, unknown>;
    return {
      kind: "detail-card",
      server: "apple-apps",
      tool: part.tool,
      title: asString(m.subject) ?? "(no subject)",
      subtitle: asString(m.from ?? m.sender) ?? undefined,
      body: asString(m.body ?? m.content),
      attachments: Array.isArray(m.attachments)
        ? (m.attachments as Array<Record<string, unknown>>).map((a) => ({ name: asString(a.name ?? a.filename) ?? "file" }))
        : undefined,
    } satisfies DetailCardMedia;
  }
  return null;
}

function list(server: string, tool: string, title: string, rows: NonNullable<ListCardMedia["rows"]>): ListCardMedia {
  return { kind: "list-card", server, tool, title, rows, totalCount: rows.length, visibleCount: 8 };
}

// ─── Office ───

/** Office tools: sheet_read → table-card; create tools → detail receipt. */
export function fromOffice(part: ToolPartLike): ToolMedia | null {
  if (isRunning(part) || part.state.status === "error") return null;
  if (part.tool.includes("sheet_read")) {
    const t = fromTableResult(part, "office", "Sheet");
    if (t) return t;
  }
  const payload = payloadOf(part);
  if (!payload) return null;
  const name = asString(payload.name ?? payload.title ?? payload.path ?? payload.file);
  if (!name) return null;
  return {
    kind: "detail-card",
    server: "office",
    tool: part.tool,
    title: name,
    subtitle: "Created",
    fields: [
      asString(payload.format) ? { label: "Format", value: asString(payload.format)! } : undefined,
      asString(payload.path) ? { label: "Path", value: asString(payload.path)! } : undefined,
    ].filter(Boolean) as Array<{ label: string; value: string }>,
  };
}

// ─── Native meta tools ───

/** tool_search → list-card of activated tools; compact → confirm; send_message → receipt; list_peers → list. */
export function fromMetaTool(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;

  // compact / send_message act on tool input, not a result payload.
  if (part.tool === "compact") {
    return {
      kind: "confirm-card",
      server: "dex",
      tool: part.tool,
      banner: "Compaction materializes a durable boundary and drops older turns from the live context.",
      fields: [{ label: "Effect", value: "Older history summarized into a Compaction Part" }],
    } satisfies ConfirmCardMedia;
  }

  if (part.tool === "send_message") {
    const to = asString(part.state.input.to);
    if (!to) return null;
    return {
      kind: "detail-card",
      server: "dex",
      tool: part.tool,
      title: `Message delivered to ${to}`,
      subtitle: "cross-session",
      body: headOf(asString(part.state.input.message)),
    } satisfies DetailCardMedia;
  }

  const payload = payloadOf(part);
  if (!payload) return null;

  if (part.tool === "tool_search") {
    const items = firstArray(payload, ["activated", "tools", "results"]);
    if (!items) return null;
    const rows = items.map((t, i) => ({
      id: asString(t.name ?? t.id) ?? String(i),
      primary: asString(t.name ?? t.id) ?? "tool",
      secondary: asString(t.description),
      chips: [asString(t.server) ? `server: ${asString(t.server)}` : ""].filter(Boolean),
    }));
    if (rows.length === 0) return null;
    return list("dex", part.tool, "Activated tools", rows);
  }

  if (part.tool === "compact") {
    return {
      kind: "confirm-card",
      server: "dex",
      tool: part.tool,
      banner: "Compaction materializes a durable boundary and drops older turns from the live context.",
      fields: [{ label: "Effect", value: "Older history summarized into a Compaction Part" }],
    } satisfies ConfirmCardMedia;
  }

  if (part.tool === "list_peers") {
    const sessions = firstArray(payload, ["sessions", "peers", "agents"]);
    if (!sessions) return null;
    const rows = sessions.map((s, i) => ({
      id: asString(s.id) ?? String(i),
      primary: asString(s.name ?? s.title ?? s.id) ?? "peer",
      secondary: asString(s.title),
      meta: typeof s.active === "boolean" ? (s.active ? "active" : "idle") : undefined,
    }));
    if (rows.length === 0) return null;
    return list("dex", part.tool, "Peers", rows);
  }

  if (part.tool === "send_message") {
    const to = asString(part.state.input.to);
    if (!to) return null;
    return {
      kind: "detail-card",
      server: "dex",
      tool: part.tool,
      title: `Message delivered to ${to}`,
      subtitle: "cross-session",
      body: headOf(asString(part.state.input.message)),
    } satisfies DetailCardMedia;
  }

  return null;
}

function headOf(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.length > 160 ? s.slice(0, 159) + "…" : s;
}

// re-export for tests
export { fromTableResult };

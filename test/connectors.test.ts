import { describe, expect, it } from "vitest";
import {
  fromCalendarAgenda,
  fromDriveList,
  fromGmailDetail,
  fromGmailEditor,
  fromGmailList,
  fromGmailSendConfirm,
  fromNotesEnvelope,
  fromSlackThread,
  fromTasksEnvelope,
} from "../src/extract/connectors.js";
import type { ToolPartLike } from "../src/types.js";

const part = (tool: string, metadata: Record<string, unknown>): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, metadata, output: undefined },
});

describe("notes + tasks envelopes", () => {
  it("parses the notes envelope from metadata", () => {
    const m = fromNotesEnvelope(part("notes_list", {
      kind: "notes",
      action: "list",
      count: 2,
      notes: [
        { path: "a.md", title: "A", tags: ["x"], time_updated: "2026-09-06T10:00:00Z" },
        { path: "b.md", title: "B", tags: [], time_updated: "2026-09-06T09:00:00Z", snippet: "hi" },
      ],
    }));
    expect(m?.kind).toBe("notes-envelope");
    expect(m?.action).toBe("list");
    expect(m?.notes).toHaveLength(2);
    expect(m?.notes?.[0].tags).toEqual(["x"]);
  });

  it("parses the tasks envelope from a JSON output string", () => {
    const m = fromTasksEnvelope({
      tool: "tasks_list",
      state: {
        status: "completed",
        input: {},
        metadata: null,
        output: JSON.stringify({ kind: "tasks", action: "list", count: 1, tasks: [{ id: "1", title: "Ship", status: "in_progress", ticket_key: "TSK-9" }] }),
      },
    });
    expect(m?.kind).toBe("tasks-envelope");
    expect(m?.tasks?.[0]).toMatchObject({ title: "Ship", ticket_key: "TSK-9" });
  });

  it("returns null on kind mismatch", () => {
    expect(fromNotesEnvelope(part("notes_list", { kind: "tasks", action: "list" }))).toBeNull();
  });
});

describe("gmail extractors", () => {
  it("list → list-card with rows", () => {
    const m = fromGmailList(part("gmail_list_emails", {
      messages: [
        { id: "1", from_name: "Dana Lopez", from_email: "dana@acme.com", subject: "Pricing", snippet: "Good news…", time: "10:42", unread: true, attachments: [{ name: "a.pdf" }] },
      ],
      total: 12,
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "rows" in m && m.rows?.[0]).toMatchObject({
      primary: "Dana Lopez — Pricing",
      unread: true,
      attachments: 1,
      meta: "10:42",
    });
    expect(m && "totalCount" in m && m.totalCount).toBe(12);
  });

  it("read_email → detail-card", () => {
    const m = fromGmailDetail(part("gmail_read_email", {
      message: { subject: "Re: Pricing", from_name: "Dana", from_email: "dana@acme.com", to: ["me@x.com"], body: "Hello", attachments: [{ name: "f.pdf", size: "1 KB" }] },
    }));
    expect(m?.kind).toBe("detail-card");
    expect(m && "title" in m && m.title).toBe("Re: Pricing");
    expect(m && "body" in m && m.body).toBe("Hello");
  });

  it("draft_email → editor-card with sign-offs", () => {
    const m = fromGmailEditor(part("gmail_draft_email", {
      draft: { to: ["dana@acme.com"], subject: "Re: Pricing", body: "Hi Dana" },
    }));
    expect(m?.kind).toBe("editor-card");
    expect(m && "primaryAction" in m && m.primaryAction).toBe("Send");
    expect(m && "signOffs" in m && m.signOffs?.length).toBeGreaterThan(0);
    expect(m && "fields" in m && m.fields.map((f) => f.label)).toEqual(["To", "Subject", "Body", "Attachments"]);
  });

  it("send_email → confirm-card with banner", () => {
    const m = fromGmailSendConfirm({
      tool: "gmail_send_email",
      state: { status: "completed", input: { to: ["a@x.com", "b@x.com"], subject: "Hi", body: "Body" }, metadata: {} },
    });
    expect(m?.kind).toBe("confirm-card");
    expect(m && "banner" in m && m.banner).toContain("wants to send");
    expect(m && "fields" in m && m.fields?.[0].value).toBe("a@x.com, b@x.com");
  });
});

describe("calendar agenda", () => {
  it("groups events by day", () => {
    const m = fromCalendarAgenda(part("google-calendar_list_events", {
      events: [
        { id: "1", title: "Sync", start: "2026-09-07T10:00:00Z", end: "2026-09-07T10:30:00Z", guests: [{ email: "a@x.com" }], recurring: true },
        { id: "2", title: "Review", start: "2026-09-08T15:00:00Z", end: "2026-09-08T16:00:00Z" },
      ],
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "groups" in m && m.groups).toHaveLength(2);
    expect(m && "groups" in m && m.groups?.[0].rows[0].chips).toContain("↻ recurring");
  });

  it("returns null with no events array", () => {
    expect(fromCalendarAgenda(part("google-calendar_list_events", {}))).toBeNull();
  });
});

describe("drive + slack", () => {
  it("drive list → list-card", () => {
    const m = fromDriveList(part("google-drive_search_files", {
      files: [
        { id: "1", name: "Brief", kind: "folder", shared_with: [{ name: "D" }] },
        { id: "2", name: "a.pdf", mime_type: "application/pdf", size: "182 KB", modified: "2h ago" },
      ],
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "rows" in m && m.rows).toHaveLength(2);
    expect(m && "rows" in m && m.rows?.[1].secondary).toContain("182 KB");
  });

  it("slack thread → list-card with reactions", () => {
    const m = fromSlackThread(part("slack_get_thread", {
      channel: "acme-deal",
      messages: [
        { ts: "10:42", user_name: "Dana", text: "Hello", reactions: [{ emoji: "👍", count: 3 }], reply_count: 2 },
      ],
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "title" in m && m.title).toBe("Slack · acme-deal");
    expect(m && "rows" in m && m.rows?.[0].chips).toContain("👍 3");
  });
});

import { describe, expect, it } from "vitest";
import { fromTrackerEnvelope, fromAppleApps, fromOffice, fromMetaTool, fromImageGen, fromStandaloneScreenshot } from "../src/extract/firstparty.js";
import type { ToolPartLike } from "../src/types.js";

const part = (tool: string, state: Partial<ToolPartLike["state"]> = {}): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, output: undefined, metadata: null, ...state },
});

describe("image-gen", () => {
  it("extracts image_data_url metadata", () => {
    const m = fromImageGen(part("image-gen", { metadata: { image_data_url: "data:image/png;base64,AAA", prompt: "a cat" } }));
    expect(m).toMatchObject({ kind: "image", url: "data:image/png;base64,AAA", alt: "a cat" });
  });
  it("extracts a bare URL output", () => {
    const m = fromImageGen(part("image-gen", { output: "https://cdn.example.com/img.png" }));
    expect(m).toMatchObject({ kind: "image", url: "https://cdn.example.com/img.png" });
  });
  it("extracts url from JSON output", () => {
    const m = fromImageGen(part("image-gen", { output: JSON.stringify({ url: "https://x/y.png" }) }));
    expect(m && "url" in m && m.url).toBe("https://x/y.png");
  });
});

describe("computer-use standalone screenshot", () => {
  it("extracts image from metadata", () => {
    const m = fromStandaloneScreenshot(part("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,B" } }));
    expect(m?.kind).toBe("image");
  });
  it("extracts image from mcp_content", () => {
    const m = fromStandaloneScreenshot(part("browser-hand_screenshot", {
      metadata: { mcp_content: [{ type: "image", data: "QUJD", mimeType: "image/jpeg" }] },
    }));
    expect(m && "url" in m && m.url).toBe("data:image/jpeg;base64,QUJD");
  });
});

describe("tracker envelope", () => {
  it("parses tracker_create_card output", () => {
    const m = fromTrackerEnvelope(part("tracker_create_card", {
      metadata: { action: "create", tickets: [{ key: "TSK-12", title: "Draft rollout", status: "In Progress" }] },
    }));
    expect(m).toMatchObject({ kind: "tracker-envelope", server: "tracker", action: "create" });
    expect(m?.tickets[0]).toMatchObject({ key: "TSK-12", title: "Draft rollout" });
  });
  it("parses dev_board output via JSON string", () => {
    const m = fromTrackerEnvelope(part("dev_board", {
      output: JSON.stringify({ action: "list", tickets: [{ key: "DEV-3", title: "Fix bug" }] }),
    }));
    expect(m?.kind).toBe("tracker-envelope");
    expect(m?.server).toBe("dev_board");
    expect(m?.tickets).toHaveLength(1);
  });
  it("returns null without action", () => {
    expect(fromTrackerEnvelope(part("tracker_find_cards", { metadata: { tickets: [] } }))).toBeNull();
  });
});

describe("apple-apps polyglot", () => {
  it("events → list-card", () => {
    const m = fromAppleApps(part("apple-apps_calendar_list_events", {
      metadata: { events: [{ id: "1", title: "Sync", start: "2026-09-12T10:00:00Z" }] },
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "rows" in m && m.rows?.[0].primary).toContain("Sync");
  });
  it("reminders → list-card with unchecked rows", () => {
    const m = fromAppleApps(part("apple-apps_reminders_list", {
      metadata: { reminders: [{ id: "r1", title: "Call Dana", completed: false, due_date: "tomorrow" }] },
    }));
    expect(m && "rows" in m && m.rows?.[0].unread).toBe(true);
  });
  it("single message → detail-card", () => {
    const m = fromAppleApps(part("apple-apps_mail_read_message", {
      metadata: { message: { subject: "Hi", from: "dana@acme.com", body: "Hello there" } },
    }));
    expect(m?.kind).toBe("detail-card");
    expect(m && "title" in m && m.title).toBe("Hi");
  });
});

describe("office", () => {
  it("sheet_read → table-card", () => {
    const m = fromOffice(part("office_office_sheet_read", {
      output: JSON.stringify({ columns: ["Item", "Qty"], rows: [["Seats", "18"], ["Discount", "20%"]] }),
    }));
    expect(m?.kind).toBe("table-card");
    expect(m && "columns" in m && m.columns).toEqual(["Item", "Qty"]);
    expect(m && "rows" in m && m.rows).toHaveLength(2);
  });
  it("create tool → detail receipt", () => {
    const m = fromOffice(part("office_office_doc_create", { metadata: { name: "Brief.docx", path: "docs/Brief.docx", format: "docx" } }));
    expect(m?.kind).toBe("detail-card");
    expect(m && "title" in m && m.title).toBe("Brief.docx");
  });
});

describe("meta tools", () => {
  it("tool_search → list-card of activated tools", () => {
    const m = fromMetaTool(part("tool_search", { output: JSON.stringify({ activated: [{ name: "browser-hand_navigate", description: "Navigate" }] }) }));
    expect(m?.kind).toBe("list-card");
  });
  it("compact → confirm-card", () => {
    const m = fromMetaTool(part("compact", { metadata: {} }));
    expect(m?.kind).toBe("confirm-card");
  });
  it("send_message → detail receipt", () => {
    const m = fromMetaTool(part("send_message", { input: { to: "research", message: "look at this" }, metadata: {} }));
    expect(m?.kind).toBe("detail-card");
    expect(m && "title" in m && m.title).toContain("research");
  });
});

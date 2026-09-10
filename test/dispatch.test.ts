import { describe, expect, it } from "vitest";
import { BUILTIN_EXTRACTORS, extractToolMedia, SERVER_EXTRACTORS } from "../src/dispatch.js";
import type { ToolPartLike, ToolMedia } from "../src/types.js";

const part = (tool: string, over: Partial<ToolPartLike["state"]> = {}): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, metadata: null, output: undefined, ...over },
});

describe("extractToolMedia dispatch", () => {
  it("routes builtin tools first", () => {
    const m = extractToolMedia(part("webfetch", { input: { url: "https://x.com" }, output: "hey" }));
    expect(m?.kind).toBe("fetch");
  });

  it("routes server-prefixed MCP tools to the server table", () => {
    const m = extractToolMedia(part("gmail_list_emails", {
      metadata: { messages: [{ id: "1", from_name: "A", subject: "S" }] },
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "server" in m && m.server).toBe("gmail");
  });

  it("falls back to mcp-result for unknown servers", () => {
    const m = extractToolMedia(part("notion_search", {
      metadata: { mcp_server: "notion", mcp_tool: "search", mcp_content: [{ type: "text", text: "3 pages" }] },
    }));
    expect(m?.kind).toBe("mcp-result");
  });

  it("falls back to json when nothing matches", () => {
    const m = extractToolMedia(part("mystery_tool", { output: '{"ok":true}' }));
    expect(m?.kind).toBe("json");
  });

  it("prefers family envelopes over everything", () => {
    const m = extractToolMedia(part("notes_list", {
      metadata: { kind: "notes", action: "list", notes: [] },
    }));
    expect(m?.kind).toBe("notes-envelope");
  });

  it("honors host overrides first", () => {
    const custom: Record<string, (p: ToolPartLike) => ToolMedia | null> = {
      gmail_list_emails: () => ({ kind: "json", title: "custom", content: "{}" }),
    };
    const m = extractToolMedia(
      part("gmail_list_emails", { metadata: { messages: [] } }),
      custom,
    );
    expect(m?.kind).toBe("json");
  });

  it("returns null for running parts on generic paths", () => {
    expect(extractToolMedia(part("webfetch", { status: "running" }))).toBeNull();
  });

  it("server tables are exposed for extension", () => {
    expect(SERVER_EXTRACTORS.gmail.list_emails).toBeDefined();
    expect(BUILTIN_EXTRACTORS.read).toBeDefined();
  });
});

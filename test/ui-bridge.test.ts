import { describe, expect, it } from "vitest";
import { parseUiResourceHostMessage } from "../src/types.js";
import { extractToolMedia } from "../src/dispatch.js";
import type { ToolPartLike } from "../src/types.js";

describe("parseUiResourceHostMessage", () => {
  it("accepts a ui-message", () => {
    expect(parseUiResourceHostMessage({ type: "ui-message", text: "  hi  " })).toEqual({ type: "ui-message", text: "hi" });
  });
  it("accepts an https open-link", () => {
    expect(parseUiResourceHostMessage({ type: "open-link", url: "https://x.example/a" })).toEqual({ type: "open-link", url: "https://x.example/a" });
  });
  it("rejects non-http(s) schemes and junk", () => {
    expect(parseUiResourceHostMessage({ type: "open-link", url: "javascript:alert(1)" })).toBeNull();
    expect(parseUiResourceHostMessage({ type: "open-link", url: "file:///etc/passwd" })).toBeNull();
    expect(parseUiResourceHostMessage({ type: "ui-message", text: "   " })).toBeNull();
    expect(parseUiResourceHostMessage({ type: "ui-message", text: 42 })).toBeNull();
    expect(parseUiResourceHostMessage({ type: "nope" })).toBeNull();
    expect(parseUiResourceHostMessage("string")).toBeNull();
    expect(parseUiResourceHostMessage(null)).toBeNull();
  });
  it("caps ui-message length at 10k", () => {
    expect(parseUiResourceHostMessage({ type: "ui-message", text: "x".repeat(10_001) })).toBeNull();
  });
});

describe("extraction trace", () => {
  const part = (tool: string, metadata: Record<string, unknown>): ToolPartLike => ({
    tool,
    state: { status: "completed", input: {}, metadata, output: undefined },
  });
  it("records the decision chain", () => {
    const trace: string[] = [];
    extractToolMedia(
      part("gmail_list_emails", { messages: [{ id: "1", from_name: "A", subject: "S" }] }),
      undefined,
      { trace },
    );
    expect(trace.some((t) => t.includes("server gmail.list_emails -> list-card"))).toBe(true);
  });
  it("records fallback for unknown payloads", () => {
    const trace: string[] = [];
    extractToolMedia(part("acme_plain", { mcp_server: "acme", mcp_tool: "plain", mcp_content: [{ type: "text", text: "x" }] }), undefined, { trace });
    expect(trace.some((t) => t.includes("mcp-result"))).toBe(true);
  });
});

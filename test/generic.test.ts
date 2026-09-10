import { describe, expect, it } from "vitest";
import {
  fromBash,
  fromDiff,
  fromJsonFallback,
  fromMcp,
  fromRead,
  fromWebFetch,
  fromWebSearch,
} from "../src/extract/generic.js";
import type { ToolPartLike } from "../src/types.js";

const part = (tool: string, state: Partial<ToolPartLike["state"]> = {}): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, output: undefined, metadata: null, ...state },
});

describe("fromRead", () => {
  it("extracts file-read media with a 2-line excerpt and line count", () => {
    const m = fromRead(part("read", { input: { path: "src/a.ts" }, output: "line1\nline2\nline3" }));
    expect(m).toEqual({ kind: "file-read", path: "src/a.ts", excerpt: "line1\nline2\n…", lines: 3 });
  });

  it("prefers metadata.image_data_url as image media", () => {
    const m = fromRead(part("read", { input: { path: "img.png" }, metadata: { image_data_url: "data:image/png;base64,AAA" } }));
    expect(m?.kind).toBe("image");
    expect(m).toMatchObject({ url: "data:image/png;base64,AAA", caption: "img.png" });
  });

  it("returns null while running", () => {
    expect(fromRead(part("read", { status: "running", input: { path: "a.ts" } }))).toBeNull();
  });
});

describe("fromWebSearch", () => {
  it("maps metadata.results into search-results media", () => {
    const m = fromWebSearch(part("websearch", {
      input: { query: "rust sdf" },
      metadata: { results: [{ url: "https://a.co", title: "A", snippet: "s" }] },
    }));
    expect(m).toEqual({ kind: "search-results", query: "rust sdf", results: [{ url: "https://a.co", title: "A", snippet: "s" }] });
  });

  it("returns null with no results and no query", () => {
    expect(fromWebSearch(part("websearch"))).toBeNull();
  });
});

describe("fromWebFetch", () => {
  it("derives title from hostname", () => {
    const m = fromWebFetch(part("webfetch", { input: { url: "https://example.com/x" }, output: "hello" }));
    expect(m).toEqual({ kind: "fetch", url: "https://example.com/x", title: "example.com", excerpt: "hello" });
  });
});

describe("fromBash", () => {
  it("extracts stdout/stderr/rc", () => {
    const m = fromBash(part("bash", { input: { command: "ls" }, metadata: { stdout: "a\nb", stderr: "", rc: 0 } }));
    expect(m).toEqual({ kind: "bash-output", stdout: "a\nb", stderr: "", rc: 0 });
  });

  it("returns null when there is no output at all", () => {
    expect(fromBash(part("bash", { metadata: { rc: 0 } }))).toBeNull();
  });
});

describe("fromDiff", () => {
  it("synthesizes a unified diff from old/new strings", () => {
    const m = fromDiff(part("edit", { input: { path: "a.ts", old_string: "x", new_string: "y" } }));
    expect(m?.kind).toBe("diff");
    expect(m && "additions" in m && m.additions).toBe(1);
    expect(m && "deletions" in m && m.deletions).toBe(1);
  });
});

describe("fromMcp", () => {
  it("builds the mcp-result envelope from stamped metadata", () => {
    const m = fromMcp(part("gmail_list_emails", {
      input: { q: "x" },
      metadata: { mcp_server: "gmail", mcp_tool: "list_emails", mcp_content: [{ type: "text", text: "3 messages" }] },
    }));
    expect(m).toEqual({
      kind: "mcp-result",
      server: "gmail",
      tool: "list_emails",
      args: { q: "x" },
      content: [{ type: "text", text: "3 messages", uri: null }],
      itemCount: 1,
    });
  });

  it("returns null without any server identity", () => {
    expect(fromMcp(part("whatever"))).toBeNull();
  });
});

describe("fromJsonFallback", () => {
  it("pretty-prints JSON output", () => {
    const m = fromJsonFallback(part("mystery_tool", { output: '{"a":1}' }));
    expect(m?.kind).toBe("json");
    expect(m && "content" in m && m.content).toBe('{\n  "a": 1\n}');
  });
});

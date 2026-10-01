import { describe, expect, it } from "vitest";
import { fromHintList, fromTableResult, fromStatStrip, registerHint } from "../src/extract/lists.js";
import { extractToolMedia } from "../src/dispatch.js";
import type { ToolPartLike } from "../src/types.js";

const part = (tool: string, state: Partial<ToolPartLike["state"]> = {}): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, output: undefined, metadata: null, ...state },
});

describe("hint-table connectors", () => {
  it("github issues → list-card with state", () => {
    const m = extractToolMedia(part("github_list_issues", {
      metadata: { issues: [{ number: 42, title: "Fix flake", state: "open", user: "mona" }] },
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "rows" in m && m.rows?.[0].primary).toContain("open · Fix flake");
    expect(m && "rows" in m && m.rows?.[0].avatar?.label).toBe("MO");
  });

  it("stripe payments → list-card", () => {
    const m = extractToolMedia(part("stripe_list_payments", {
      metadata: { data: [{ id: "pi_1", description: "Sub", status: "succeeded", created: "2026-09-12" }] },
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "server" in m && m.server).toBe("stripe");
  });

  it("notion search → list-card from results array", () => {
    const m = extractToolMedia(part("notion_search", {
      metadata: { results: [{ id: "p1", title: "Q4 brief", url: "https://notion.so/x" }] },
    }));
    expect(m?.kind).toBe("list-card");
  });

  it("linear issues → list-card with identifier key", () => {
    const m = extractToolMedia(part("linear_list_issues", {
      metadata: { issues: [{ identifier: "ENG-9", title: "Ship it", state: "In Progress" }] },
    }));
    expect(m?.kind).toBe("list-card");
    expect(m && "rows" in m && m.rows?.[0].id).toBe("ENG-9");
    expect(m && "rows" in m && m.rows?.[0].primary).toContain("Ship it");
  });

  it("unknown payload shape falls through to mcp-result", () => {
    const m = extractToolMedia(part("github_weird_call", {
      metadata: { mcp_server: "github", mcp_tool: "weird_call", mcp_content: [{ type: "text", text: "nothing listy" }] },
    }));
    expect(m?.kind).toBe("mcp-result");
  });

  it("registerHint extends coverage at runtime", () => {
    registerHint("acme", { fm: { title: ["name"] }, title: "Acme" });
    const m = fromHintList(part("acme_list_things", { metadata: { things: [{ name: "Widget" }] } }), "acme");
    expect(m?.kind).toBe("list-card");
  });
});

describe("table servers", () => {
  it("postgres query → table-card", () => {
    const m = extractToolMedia(part("postgres_query", {
      output: JSON.stringify({ columns: ["id", "email"], rows: [[1, "a@x.com"], [2, "b@x.com"]] }),
    }));
    expect(m?.kind).toBe("table-card");
    expect(m && "rows" in m && m.rows).toHaveLength(2);
  });

  it("supabase object rows derive columns from the first row", () => {
    const m = extractToolMedia(part("supabase_list_records", {
      metadata: { rows: [{ name: "A", qty: 1 }, { name: "B", qty: 2 }] },
    }));
    expect(m?.kind).toBe("table-card");
    expect(m && "columns" in m && m.columns).toEqual(["name", "qty"]);
  });

  it("non-tabular postgres result falls through", () => {
    const m = extractToolMedia(part("postgres_query", { output: "UPDATE 3" }));
    expect(m?.kind === "table-card").toBe(false);
  });
});

describe("stat strip", () => {
  it("flat numeric payload → stat-strip", () => {
    const m = fromStatStrip(part("stripe_get_balance", { metadata: { balance: 1240, pending: 90 } }), "stripe", "Balance");
    expect(m?.kind).toBe("stat-strip");
    expect(m && "stats" in m && m.stats[0]).toMatchObject({ value: "1240", accent: true });
  });

  it("too many keys → null", () => {
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(fromStatStrip(part("x", { metadata: big }), "x", "X")).toBeNull();
  });
});

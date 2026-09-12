import { describe, expect, it } from "vitest";
import { fromUiResource } from "../src/extract/generic.js";
import { extractToolMedia } from "../src/dispatch.js";
import type { ToolPartLike } from "../src/types.js";

const part = (tool: string, state: Partial<ToolPartLike["state"]> = {}): ToolPartLike => ({
  tool,
  state: { status: "completed", input: {}, output: undefined, metadata: null, ...state },
});

describe("fromUiResource", () => {
  it("extracts SEP-1865 _meta.ui resourceUri bindings (flattened metadata)", () => {
    const m = fromUiResource(part("acme_chart_render", {
      metadata: {
        mcp_server: "acme",
        mcp_tool: "chart_render",
        ui: { resourceUri: "ui://acme/chart-abc", csp: { connectDomains: ["api.acme.com"] } },
      },
    }));
    expect(m).toEqual({
      kind: "ui-resource",
      server: "acme",
      tool: "chart_render",
      resourceUri: "ui://acme/chart-abc",
      html: undefined,
      mimeType: undefined,
      csp: { connectDomains: ["api.acme.com"] },
    });
  });

  it("reads metadata._meta.ui when the host passes raw result meta through", () => {
    const m = fromUiResource(part("acme_widget", {
      metadata: {
        mcp_server: "acme",
        _meta: { ui: { resourceUri: "ui://acme/widget-1" } },
      },
    }));
    expect(m?.kind).toBe("ui-resource");
    expect(m && "resourceUri" in m && m.resourceUri).toBe("ui://acme/widget-1");
  });

  it("extracts inlined HTML from an MCP resource content item with ui:// uri", () => {
    const m = fromUiResource(part("acme_view", {
      metadata: {
        mcp_server: "acme",
        mcp_content: [
          { type: "text", text: "fallback text" },
          { type: "resource", uri: "ui://acme/view-1", mimeType: "text/html;profile=mcp-apps", text: "<h1>Hi</h1>" },
        ],
      },
    }));
    expect(m).toMatchObject({
      kind: "ui-resource",
      server: "acme",
      tool: "acme_view",
      resourceUri: "ui://acme/view-1",
      html: "<h1>Hi</h1>",
      mimeType: "text/html;profile=mcp-apps",
    });
  });

  it("decodes base64 blob resource content", () => {
    const html = "<p>blob body</p>";
    const b64 = Buffer.from(html).toString("base64");
    const m = fromUiResource(part("acme_view", {
      metadata: { mcp_server: "acme" },
      output: JSON.stringify({ content: [{ type: "resource", uri: "ui://acme/view-2", blob: b64 }] }),
    }));
    expect(m && "html" in m && m.html).toBe(html);
  });

  it("returns null without server identity", () => {
    expect(fromUiResource(part("x", { metadata: { ui: { resourceUri: "ui://a/b" } } }))).toBeNull();
  });

  it("returns null while running", () => {
    expect(fromUiResource(part("acme_chart_render", { status: "running", metadata: { mcp_server: "acme", ui: { resourceUri: "ui://acme/c" } } }))).toBeNull();
  });

  it("returns null when there is no ui binding at all", () => {
    expect(fromUiResource(part("acme_plain", { metadata: { mcp_server: "acme" } }))).toBeNull();
  });
});

describe("dispatch interop", () => {
  it("routes a ui://-carrying tool to ui-resource before the generic mcp-result", () => {
    const m = extractToolMedia(part("acme_chart_render", {
      metadata: {
        mcp_server: "acme",
        mcp_tool: "chart_render",
        mcp_content: [{ type: "text", text: "boring json" }],
        ui: { resourceUri: "ui://acme/chart-abc" },
      },
    }));
    expect(m?.kind).toBe("ui-resource");
  });

  it("non-Apps tools still fall through to mcp-result", () => {
    const m = extractToolMedia(part("acme_plain", {
      metadata: { mcp_server: "acme", mcp_tool: "plain", mcp_content: [{ type: "text", text: "ok" }] },
    }));
    expect(m?.kind).toBe("mcp-result");
  });
});

// Computer Use / Browser activity grouping + frame builder.
//
// Ported from Dextop's parts-v2/activity-grouping.ts (pure logic, no React).
// Groups consecutive reasoning + tool Parts of the same family into blocks,
// pairs each screenshot with the reasoning that immediately preceded it, and
// reduces a block to ordered frames for the host's horizontal strip renderer.

import type { ActivityFrame, ActivityFamily, ActivityPartLike, ActivityStripMedia, ToolPartLike } from "../types.js";
import { canonicalToolName } from "./helpers.js";

const COMPUTER_USE_PREFIX = "computer-use_";
const BROWSER_PREFIXES = ["browser-hand_", "chrome-devtools_", "agent-browser_"];

const SCREENSHOT_TOOLS = new Set([
  "computer-use_screenshot",
  "computer-use_zoom",
  "browser-hand_screenshot",
  "browser-hand_snapshot",
  "chrome-devtools_take_screenshot",
  "agent-browser_screenshot",
]);

export function isComputerUseToolPart(part: ActivityPartLike): part is ToolPartLike & { type: "tool" } {
  return part.type === "tool" && canonicalToolName(part.tool).startsWith(COMPUTER_USE_PREFIX);
}

export function isBrowserToolPart(part: ActivityPartLike): part is ToolPartLike & { type: "tool" } {
  return part.type === "tool" && BROWSER_PREFIXES.some((p) => canonicalToolName(part.tool).startsWith(p));
}

export function activityToolKind(tool: string): "screenshot" | "action" {
  return SCREENSHOT_TOOLS.has(canonicalToolName(tool)) ? "screenshot" : "action";
}

// ─── Action chip labels ───

function coordsFromInput(input: Record<string, unknown>): string | null {
  if (Array.isArray(input.coordinate) && input.coordinate.length >= 2) {
    return `${input.coordinate[0]},${input.coordinate[1]}`;
  }
  if (typeof input.x === "number" && typeof input.y === "number") return `${input.x},${input.y}`;
  if (typeof input.coords === "string") return input.coords;
  return null;
}

function truncate(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max - 1) + (value.length > max - 1 ? "…" : "");
}

/** Human-readable one-line label for a non-screenshot action chip. */
export function activityActionLabel(tool: string, input: Record<string, unknown>): string {
  const canonical = canonicalToolName(tool);
  const coord = coordsFromInput(input);
  switch (canonical) {
    case "computer-use_click":
      return coord ? `Click ${coord}` : "Click";
    case "computer-use_double_click":
      return coord ? `Double-click ${coord}` : "Double-click";
    case "computer-use_right_click":
      return coord ? `Right-click ${coord}` : "Right-click";
    case "computer-use_move":
      return coord ? `Move ${coord}` : "Move";
    case "computer-use_type":
    case "computer-use_input_text":
      return `Type "${truncate(isString0(input.text) ?? isString0(input.content) ?? "", 24)}"`;
    case "computer-use_key":
    case "computer-use_keypress":
      return `Key ${isString0(input.key) ?? isString0(input.keys) ?? "?"}`;
    case "computer-use_scroll": {
      const amount = input.amount ?? input.delta;
      return `Scroll ${typeof amount === "number" ? amount : ""}`.trim();
    }
    case "computer-use_drag":
      return "Drag";
    case "computer-use_zoom":
      return "Zoom";
    case "browser-hand_navigate":
    case "chrome-devtools_navigate_page":
      return `Go to ${truncate(isString0(input.url) ?? "", 28)}`;
    case "browser-hand_reload":
      return "Reload";
    case "browser-hand_back":
      return "Back";
    case "browser-hand_forward":
      return "Forward";
    case "browser-hand_click":
    case "chrome-devtools_click":
      return typeof input.uid === "string" ? `Click ${input.uid}` : coord ? `Click ${coord}` : "Click";
    case "browser-hand_type":
      return `Type "${truncate(isString0(input.text) ?? "", 24)}"`;
    case "browser-hand_snapshot":
    case "chrome-devtools_take_snapshot":
      return "Snapshot";
    case "browser-hand_evaluate":
    case "chrome-devtools_evaluate_script":
      return "Evaluate";
    case "browser-hand_console":
    case "chrome-devtools_list_console_messages":
      return "Console";
    case "browser-hand_takeover":
      return "Takeover requested";
    default: {
      const withoutFamily = canonical.replace(/^[^_]+_/, "");
      return withoutFamily.replace(/_/g, " ") || "Action";
    }
  }
}

function isString0(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Local SVG asset hint for an action chip (host resolves against its icon set). */
export function activityActionIcon(tool: string, family: ActivityFamily): string {
  const canonical = canonicalToolName(tool);
  if (family === "computer-use") {
    const map: Record<string, string> = {
      "computer-use_click": "cursor-click",
      "computer-use_double_click": "cursor-click",
      "computer-use_right_click": "mouse",
      "computer-use_move": "pointer",
      "computer-use_drag": "cursor",
      "computer-use_type": "type",
      "computer-use_input_text": "type",
      "computer-use_key": "key",
      "computer-use_keypress": "key",
      "computer-use_scroll": "mouse",
      "computer-use_set_value": "type",
    };
    return map[canonical] ?? "screen";
  }
  const browserMap: Record<string, string> = {
    "browser-hand_navigate": "globe",
    "chrome-devtools_navigate_page": "globe",
    "agent-browser_navigate": "globe",
    "browser-hand_reload": "refresh",
    "chrome-devtools_reload": "refresh",
    "browser-hand_back": "arrow-left",
    "browser-hand_forward": "arrow-right",
    "chrome-devtools_back": "arrow-left",
    "chrome-devtools_forward": "arrow-right",
    "browser-hand_click": "cursor-click",
    "chrome-devtools_click": "cursor-click",
    "agent-browser_click": "cursor-click",
    "browser-hand_type": "type",
    "chrome-devtools_fill": "type",
    "browser-hand_screenshot": "screen",
    "browser-hand_snapshot": "screen",
    "chrome-devtools_take_screenshot": "screen",
    "agent-browser_screenshot": "screen",
    "browser-hand_evaluate": "terminal",
    "chrome-devtools_evaluate_script": "terminal",
    "browser-hand_console": "terminal",
    "chrome-devtools_list_console_messages": "terminal",
  };
  return browserMap[canonical] ?? "globe";
}

// ─── Frame pairing ───

function extractScreenshotUrl(part: ToolPartLike): { imageUrl: string | null; windowId: number | null } {
  const metadata = (part.state.metadata ?? {}) as Record<string, unknown>;
  const direct = typeof metadata.image_data_url === "string" ? metadata.image_data_url : null;
  if (direct) {
    return {
      imageUrl: direct,
      windowId: typeof metadata.window_id === "number" ? metadata.window_id : null,
    };
  }

  // browser-hand / MCP contracts: parse the output JSON for image data —
  // either a bare array of MCP content items, or an object carrying a
  // `content` array (optionally stamped as metadata.mcp_content).
  const output = part.state.output;
  const candidates: unknown[] = [];
  if (typeof output === "string") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = null;
    }
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.image === "string") {
        const mime =
          typeof obj.mime === "string"
            ? obj.mime
            : typeof obj.mime_type === "string"
              ? obj.mime_type
              : "image/png";
        return {
          imageUrl: obj.image.startsWith("data:") ? obj.image : `data:${mime};base64,${obj.image}`,
          windowId: null,
        };
      }
      if (Array.isArray(obj.content)) candidates.push(obj.content);
    } else if (Array.isArray(parsed)) {
      candidates.push(parsed);
    }
  }
  if (Array.isArray(metadata.mcp_content)) candidates.push(metadata.mcp_content);

  for (const arr of candidates) {
    for (const item of arr as unknown[]) {
      if (item !== null && typeof item === "object" && (item as Record<string, unknown>).type === "image") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.data === "string") {
          const mime = typeof obj.mimeType === "string" ? obj.mimeType : typeof obj.mime_type === "string" ? obj.mime_type : "image/png";
          return {
            imageUrl: obj.data.startsWith("data:") ? obj.data : `data:${mime};base64,${obj.data}`,
            windowId: null,
          };
        }
      }
    }
  }
  return { imageUrl: null, windowId: null };
}

/** A maximal contiguous run of same-family activity (reasoning + tools). */
export interface ActivityBlock {
  parts: ActivityPartLike[];
  family: ActivityFamily;
}

/** Group a message's Parts into per-family activity blocks. */
export function groupActivityBlocks(parts: ActivityPartLike[]): ActivityBlock[] {
  const blocks: ActivityBlock[] = [];
  let current: ActivityPartLike[] = [];
  let hasTool = false;
  let currentFamily: ActivityFamily | null = null;

  const familyOf = (p: ActivityPartLike): ActivityFamily | null => {
    if (p.type === "reasoning") return currentFamily;
    if (isComputerUseToolPart(p)) return "computer-use";
    if (isBrowserToolPart(p)) return "browser";
    return null;
  };

  const flush = () => {
    if (current.length > 0 && hasTool && currentFamily !== null) {
      blocks.push({ parts: current, family: currentFamily });
    }
    current = [];
    hasTool = false;
    currentFamily = null;
  };

  for (const p of parts) {
    const fam = familyOf(p);
    if (p.type === "reasoning") {
      current.push(p);
      continue;
    }
    if (fam !== null && fam === currentFamily) {
      current.push(p);
      hasTool = true;
      continue;
    }
    if (fam !== null && currentFamily === null) {
      current.push(p);
      hasTool = true;
      currentFamily = fam;
      continue;
    }
    flush();
    if (fam !== null) {
      current.push(p);
      hasTool = true;
      currentFamily = fam;
    }
  }
  flush();
  return blocks;
}

/** Reduce a block into ordered frames for the host's horizontal strip. */
export function buildActivityFrames(block: ActivityBlock): ActivityFrame[] {
  const frames: ActivityFrame[] = [];
  const pendingReasoning: string[] = [];

  for (const part of block.parts) {
    if (part.type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : "";
      if (text.trim()) pendingReasoning.push(text);
      continue;
    }
    if (part.type !== "tool") continue;
    if (!(isComputerUseToolPart(part) || isBrowserToolPart(part))) continue;
    const tp: ToolPartLike & { type: "tool" } = part;

    if (activityToolKind(tp.tool) === "screenshot") {
      const reasoning = pendingReasoning.length ? pendingReasoning.join("\n\n") : null;
      pendingReasoning.length = 0;
      const { imageUrl, windowId } = extractScreenshotUrl(tp);
      frames.push({ type: "screenshot", tool: tp.tool, imageUrl, reasoning, windowId, family: block.family });
    } else {
      frames.push({
        type: "action",
        tool: tp.tool,
        label: activityActionLabel(tp.tool, tp.state.input ?? {}),
        icon: activityActionIcon(tp.tool, block.family),
        family: block.family,
      });
    }
  }

  if (pendingReasoning.length) {
    frames.push({ type: "thought", text: pendingReasoning.join("\n\n"), family: block.family });
  }
  return frames;
}

/** Full extractor: a contiguous computer-use/browser run → strip descriptor. */
export function fromActivityBlock(parts: ActivityPartLike[]): ActivityStripMedia | null {
  const blocks = groupActivityBlocks(parts);
  if (blocks.length === 0) return null;
  const frames = blocks.flatMap((b) => buildActivityFrames(b));
  if (frames.length === 0) return null;
  return {
    kind: "activity-strip",
    family: blocks[0].family,
    frames,
    steps: frames.filter((f) => f.type !== "thought").length,
  };
}

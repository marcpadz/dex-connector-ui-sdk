import { describe, expect, it } from "vitest";
import {
  activityActionLabel,
  buildActivityFrames,
  fromActivityBlock,
  groupActivityBlocks,
} from "../src/extract/activity.js";
import type { ActivityPartLike } from "../src/types.js";

const tool = (name: string, over: Record<string, unknown> = {}): ActivityPartLike => ({
  type: "tool",
  tool: name,
  state: { status: "completed", input: {}, metadata: {}, ...over },
});
const reasoning = (text: string): ActivityPartLike => ({ type: "reasoning", text });

describe("groupActivityBlocks", () => {
  it("groups consecutive same-family tools with interleaved reasoning", () => {
    const blocks = groupActivityBlocks([
      reasoning("let me look"),
      tool("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,A" } }),
      tool("computer-use_click", { input: { coordinate: [10, 20] } }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].family).toBe("computer-use");
    expect(blocks[0].parts).toHaveLength(3);
  });

  it("splits blocks when the family changes", () => {
    const blocks = groupActivityBlocks([
      tool("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,A" } }),
      tool("browser-hand_navigate", { input: { url: "https://x.com" } }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].family).toBe("computer-use");
    expect(blocks[1].family).toBe("browser");
  });

  it("drops reasoning-only runs", () => {
    expect(groupActivityBlocks([reasoning("thinking"), reasoning("still thinking")])).toHaveLength(0);
  });
});

describe("buildActivityFrames", () => {
  it("pairs reasoning with the NEXT screenshot and renders actions as chips", () => {
    const frames = buildActivityBlocksFrames();
    expect(frames[0]).toEqual({
      type: "screenshot",
      tool: "computer-use_screenshot",
      imageUrl: "data:image/png;base64,A",
      reasoning: "let me look at the screen",
      windowId: null,
      family: "computer-use",
    });
    expect(frames[1]).toMatchObject({ type: "action", label: "Click 342,218" });
  });

  it("extracts base64 MCP image content from output JSON", () => {
    const frames = buildActivityFrames({
      family: "browser",
      parts: [
        tool("browser-hand_screenshot", {
          output: JSON.stringify({ content: [{ type: "image", data: "QUJD", mimeType: "image/jpeg" }] }),
          metadata: {},
        }),
      ],
    });
    expect(frames[0]).toMatchObject({ type: "screenshot", imageUrl: "data:image/jpeg;base64,QUJD" });
  });

  it("emits a trailing thought frame for unpaired reasoning", () => {
    const frames = buildActivityFrames({
      family: "computer-use",
      parts: [tool("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,A" } }), reasoning("done for now")],
    });
    expect(frames[frames.length - 1]).toMatchObject({ type: "thought", text: "done for now" });
  });
});

function buildActivityBlocksFrames() {
  return buildActivityFrames({
    family: "computer-use",
    parts: [
      reasoning("let me look at the screen"),
      tool("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,A" } }),
      tool("computer-use_click", { input: { coordinate: [342, 218] } }),
    ],
  });
}

describe("activityActionLabel", () => {
  it("labels computer-use actions", () => {
    expect(activityActionLabel("computer-use_click", { coordinate: [1, 2] })).toBe("Click 1,2");
    expect(activityActionLabel("computer-use_type", { text: "hello world" })).toBe('Type "hello world"');
    expect(activityActionLabel("computer-use_key", { key: "Enter" })).toBe("Key Enter");
  });

  it("labels browser-hand actions", () => {
    expect(activityActionLabel("browser-hand_navigate", { url: "https://example.com/page" })).toBe("Go to https://example.com/page");
    expect(activityActionLabel("browser-hand_console", {})).toBe("Console");
  });
});

describe("fromActivityBlock", () => {
  it("returns a full strip descriptor", () => {
    const m = fromActivityBlock([
      reasoning("look"),
      tool("computer-use_screenshot", { metadata: { image_data_url: "data:image/png;base64,A" } }),
      tool("computer-use_click", { input: { coordinate: [1, 2] } }),
    ]);
    expect(m?.kind).toBe("activity-strip");
    expect(m && "steps" in m && m.steps).toBe(2);
    expect(m && "frames" in m && m.frames).toHaveLength(2);
  });

  it("returns null with no tool parts", () => {
    expect(fromActivityBlock([reasoning("just thinking")])).toBeNull();
  });
});

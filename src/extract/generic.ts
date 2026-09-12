// Generic per-tool extractors — ported from Dextop's tool-media-extractors.ts,
// reduced to pure functions over ToolPartLike.

import type {
  BashOutputMedia,
  DiffMedia,
  FetchMedia,
  FileReadMedia,
  SearchResultsMedia,
  SearchResult,
  ToolMedia,
  ToolPartLike,
  McpContentItem,
  McpResultMedia,
  CodeMedia,
  MarkdownMedia,
  SvgMedia,
  HtmlMedia,
  ImageMedia,
  VideoMedia,
} from "../types.js";
import {
  asString,
  basename,
  headLines,
  isRunning,
  isString,
  partMetadata,
  SVG_EXT_RE,
  tailLines,
  unwrapOutput,
} from "./helpers.js";

// ─── read ───

export function fromRead(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;
  const input = part.state.input;
  const metadata = partMetadata(part);
  const filePath =
    asString(metadata.filePath) ?? asString(metadata.file_path) ?? asString(input.path);
  const output = unwrapOutput(part.state.output);

  if (filePath && SVG_EXT_RE.test(filePath) && output) {
    return { kind: "svg", content: output, title: basename(filePath), filePath } satisfies SvgMedia;
  }
  if (filePath && /\.html?$/i.test(filePath) && output) {
    return { kind: "html", content: output, title: basename(filePath), filePath } satisfies HtmlMedia;
  }

  const imageDataUrl = asString(metadata.image_data_url);
  if (imageDataUrl) {
    return {
      kind: "image",
      url: imageDataUrl,
      alt: filePath ? basename(filePath) : "Image",
      caption: filePath ? basename(filePath) : undefined,
    } satisfies ImageMedia;
  }

  if (output && filePath) {
    return {
      kind: "file-read",
      path: filePath,
      excerpt: headLines(output, 2),
      lines: output.split("\n").length,
    } satisfies FileReadMedia;
  }
  return null;
}

// ─── websearch ───

export function fromWebSearch(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;
  const input = part.state.input;
  const metadata = partMetadata(part);
  const query = asString(input.query) ?? asString(metadata.query) ?? "";

  let results: SearchResult[] = [];
  const rawResults = metadata.results ?? metadata.sources;
  if (Array.isArray(rawResults)) {
    results = rawResults
      .map((r): SearchResult | null => {
        const obj = r as Record<string, unknown>;
        const url = asString(obj.url) ?? asString(obj.link);
        const title = asString(obj.title);
        const snippet = asString(obj.snippet) ?? asString(obj.description);
        if (!url && !title) return null;
        return { url: url ?? "", title: title ?? url ?? "", snippet: snippet ?? "" };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  if (results.length === 0 && !query) return null;
  return { kind: "search-results", query, results } satisfies SearchResultsMedia;
}

// ─── webfetch ───

export function fromWebFetch(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;
  const input = part.state.input;
  const metadata = partMetadata(part);
  const url = asString(input.url) ?? asString(metadata.url);
  if (!url) return null;

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // keep raw url
  }
  const title = asString(metadata.title) ?? asString(metadata.page_title) ?? hostname;
  const excerpt = headLines(asString(part.state.output) ?? asString(metadata.excerpt) ?? "", 4);
  return { kind: "fetch", url, title, excerpt } satisfies FetchMedia;
}

// ─── bash ───

export function fromBash(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;
  const metadata = partMetadata(part);
  const stdout = asString(metadata.stdout) ?? asString(part.state.output) ?? "";
  const stderr = asString(metadata.stderr) ?? "";
  const rcRaw = metadata.rc ?? metadata.return_code ?? metadata.exit_code;
  const rc = typeof rcRaw === "number" ? rcRaw : null;

  if (!stdout && !stderr) return null;
  return {
    kind: "bash-output",
    stdout: tailLines(stdout, 3),
    stderr: tailLines(stderr, 3),
    rc,
  } satisfies BashOutputMedia;
}

// ─── write / edit → diff or code ───

function diffStats(content: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function langFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python",
    rs: "rust", go: "go", java: "java", rb: "ruby", php: "php", sh: "bash",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml", html: "html",
    css: "css", scss: "scss", sql: "sql", swift: "swift", kt: "kotlin",
  };
  return map[ext] ?? ext ?? "text";
}

export function fromWriteOrEdit(part: ToolPartLike): ToolMedia | null {
  if (part.state.status !== "completed") return null;
  const input = part.state.input;
  const metadata = partMetadata(part);
  const filePath =
    asString(metadata.filePath) ?? asString(metadata.file_path) ?? asString(input.path) ?? "file";
  const content =
    asString(input.content) ??
    asString(input.newString) ??
    asString(input.new_string) ??
    asString(metadata.content);
  if (!content) return null;

  if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) {
    return { kind: "markdown", content, title: basename(filePath), filePath } satisfies MarkdownMedia;
  }
  return {
    kind: "code",
    language: langFromPath(filePath),
    content,
    title: basename(filePath),
    filePath,
  } satisfies CodeMedia;
}

export function fromDiff(part: ToolPartLike): DiffMedia | null {
  if (part.state.status !== "completed") return null;
  const input = part.state.input;
  const metadata = partMetadata(part);
  const filePath =
    asString(metadata.filePath) ??
    asString(metadata.file_path) ??
    asString(input.path) ??
    "Changes";
  const before = asString(input.oldString) ?? asString(input.old_string);
  const after = asString(input.newString) ?? asString(input.new_string);

  const explicit = unwrapOutput(metadata.diff) ?? unwrapOutput(metadata.patch);
  const output = unwrapOutput(part.state.output);
  let content = explicit ?? output ?? "";

  if ((!content || !/(^|\n)(---\s|\+\+\+\s|@@\s)/m.test(content)) && before != null && after != null) {
    content = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@", ...before.split("\n").map((l) => `-${l}`), ...after.split("\n").map((l) => `+${l}`)].join("\n");
  }
  if (!content) return null;

  const unifiedStart = content.search(/^---\s/m);
  if (unifiedStart > 0) content = content.slice(unifiedStart);

  return { kind: "diff", content, title: basename(filePath), ...diffStats(content) };
}

// ─── MCP results ───

export function fromMcp(part: ToolPartLike): McpResultMedia | null {
  if (isRunning(part)) return null;
  const metadata = partMetadata(part);
  const server = asString(metadata.mcp_server);
  const tool = asString(metadata.mcp_tool);
  const titleHint = asString(part.state.title) ?? "";
  const legacyMatch = titleHint.match(/^\[MCP:\s*(.+?)\]/i);
  const serverName = server ?? legacyMatch?.[1];
  if (!serverName) return null;

  const rawContent = Array.isArray(metadata.mcp_content) ? metadata.mcp_content : [];
  const content: McpContentItem[] = rawContent
    .map((raw): McpContentItem | null => {
      const obj = raw as Record<string, unknown>;
      if (obj.type !== "text" && obj.type !== "image" && obj.type !== "resource") return null;
      return {
        type: obj.type,
        text: isString(obj.text) ? obj.text : undefined,
        uri: isString(obj.uri) ? obj.uri : null,
        mime_type: isString(obj.mime_type) ? obj.mime_type : undefined,
      };
    })
    .filter((x): x is McpContentItem => x !== null);

  if (content.length === 0) {
    const out = asString(part.state.output);
    if (out) content.push({ type: "text", text: headLines(out, 4) });
  }

  const args = (
    metadata.mcp_args && typeof metadata.mcp_args === "object"
      ? metadata.mcp_args
      : part.state.input && typeof part.state.input === "object"
        ? part.state.input
        : {}
  ) as Record<string, unknown>;
  const itemCount =
    typeof metadata.mcp_item_count === "number" ? metadata.mcp_item_count : content.length;

  return { kind: "mcp-result", server: serverName, tool: tool ?? part.tool, args, content, itemCount };
}

// ─── MCP Apps / UIResource (SEP-1865 interop) ───

const UI_URI_PREFIX = "ui://";

function decodeResourceHtml(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string" && item.text.trim()) return item.text;
  if (typeof item.blob === "string" && item.blob.trim()) {
    try {
      // MCP resources may inline the document base64-encoded.
      const decoded = atob(item.blob);
      return decoded.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function collectCsp(uiMeta: Record<string, unknown>): Record<string, string[]> | undefined {
  const csp = uiMeta.csp;
  if (!csp || typeof csp !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(csp as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value.split(/\s+/).filter(Boolean);
    else if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === "string");
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Extract an MCP Apps UIResource (SEP-1865 / MCP-UI) from a tool result.
 * Recognizes all three delivery shapes:
 *  1. `_meta.ui.resourceUri` (host fetches via resources/read) with optional
 *     `_meta.ui.csp` directives.
 *  2. An MCP content item `{ type: "resource", uri: "ui://…" }` with the HTML
 *     inlined as `text` or base64 `blob` (checked in metadata.mcp_content,
 *     the output JSON, and output resource arrays).
 *  3. `_meta.ui.html` — a server convenience inlining.
 * Returns null when the result carries no UI identity — the dispatch then
 * falls through to the generic mcp-result/JSON chain.
 */
export function fromUiResource(part: ToolPartLike): import("../types.js").UiResourceMedia | null {
  if (isRunning(part)) return null;
  const metadata = partMetadata(part);
  const server = asString(metadata.mcp_server) ?? asString(part.state.title)?.match(/^\[MCP:\s*(.+?)\]/i)?.[1];
  if (!server) return null;

  const tool = asString(metadata.mcp_tool) ?? part.tool;

  // Shape 1 + 3: `_meta.ui` (hosts flatten SEP-1865 result meta into
  // metadata, so the binding lives at metadata.ui or metadata._meta.ui).
  const uiMetaRaw = (metadata.ui ??
    (metadata._meta as Record<string, unknown> | undefined)?.ui) as
    | Record<string, unknown>
    | undefined;
  if (uiMetaRaw && typeof uiMetaRaw === "object") {
    const resourceUri = asString(uiMetaRaw.resourceUri) ?? asString(uiMetaRaw.uri);
    const html = asString(uiMetaRaw.html);
    if (resourceUri?.startsWith(UI_URI_PREFIX) || html) {
      return {
        kind: "ui-resource",
        server,
        tool,
        resourceUri: resourceUri ?? "",
        html,
        mimeType: asString(uiMetaRaw.mimeType) ?? asString(uiMetaRaw.mime_type),
        csp: collectCsp(uiMetaRaw),
      };
    }
  }

  // Shape 2: an MCP resource content item with a ui:// URI.
  const candidates: unknown[] = [];
  if (Array.isArray(metadata.mcp_content)) candidates.push(metadata.mcp_content);
  if (typeof part.state.output === "string") {
    try {
      const parsed = JSON.parse(part.state.output) as unknown;
      if (Array.isArray(parsed)) candidates.push(parsed);
      else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).content)) {
        candidates.push((parsed as Record<string, unknown>).content);
      }
    } catch {
      // not JSON
    }
  }
  for (const arr of candidates) {
    for (const raw of arr as unknown[]) {
      if (raw === null || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (item.type !== "resource") continue;
      const uri = asString(item.uri) ?? asString((item.resource as Record<string, unknown>)?.uri);
      if (!uri || !uri.startsWith(UI_URI_PREFIX)) continue;
      const inner = (item.resource as Record<string, unknown>) ?? item;
      return {
        kind: "ui-resource",
        server,
        tool,
        resourceUri: uri,
        html: decodeResourceHtml(item) ?? decodeResourceHtml(inner),
        mimeType: asString(item.mimeType) ?? asString(item.mime_type) ?? asString(inner.mimeType),
        csp: collectCsp((metadata.ui as Record<string, unknown>) ?? {}),
      };
    }
  }

  return null;
}

// ─── JSON fallback ───

export function fromJsonFallback(part: ToolPartLike): import("../types.js").JsonMedia | null {
  if (part.state.status !== "completed") return null;
  const output = asString(part.state.output);
  const metadata = partMetadata(part);
  const payload = output ?? (Object.keys(metadata).length > 0 ? metadata : null);
  if (payload == null) return null;

  let content: string;
  if (typeof payload === "string") {
    try {
      content = JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      content = payload;
    }
  } else {
    content = JSON.stringify(payload, null, 2);
  }

  return { kind: "json", title: part.state.title ?? part.tool, content };
}

// ─── video-gen ───

export function fromVideoGen(part: ToolPartLike): VideoMedia | null {
  if (part.state.status !== "completed") return null;
  const metadata = partMetadata(part);
  const output = asString(part.state.output);
  let url = asString(metadata.video_url ?? metadata.url ?? metadata.videoUrl);
  let title = asString(part.state.title) ?? asString(metadata.title);

  if (!url && output) {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      url = asString(parsed.video_url ?? parsed.url ?? parsed.videoUrl);
      title = title ?? asString(parsed.title);
    } catch {
      // not JSON
    }
  }

  const videoUrl = url ?? (output?.startsWith("http") ? output : undefined);
  if (!videoUrl) return null;
  return { kind: "video", url: videoUrl, title: title ?? "Generated Video" };
}

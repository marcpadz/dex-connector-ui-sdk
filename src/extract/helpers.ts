// Shared helpers for extractors (ported from Dextop's tool-media-extractors).

import type { ToolPartLike } from "../types.js";

export function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function asString(v: unknown): string | undefined {
  return isString(v) ? v : undefined;
}

/** Unwrap `{output: …}` / `{diff: …}` / `{patch: …}` JSON envelopes; passthrough otherwise. */
export function unwrapOutput(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return asString(parsed.output) ?? asString(parsed.diff) ?? asString(parsed.patch) ?? value;
  } catch {
    return value;
  }
}

export function headLines(s: string, max: number): string {
  if (!s) return "";
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  return lines.length <= max ? s : lines.slice(0, max).join("\n") + "\n…";
}

export function tailLines(s: string, max: number): string {
  if (!s) return "";
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  return lines.length <= max ? s : lines.slice(0, max).join("\n") + "\n…";
}

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic)$/i;
export const SVG_EXT_RE = /\.svg$/i;

/** Dextop-faithful canonicalization: lowercase + strip the `dexlab_` prefix
 *  once. NOTE: server-prefixed ids like `computer-use_screenshot` are kept
 *  intact — family detection depends on the full prefixed name. */
export function canonicalToolName(tool: string): string {
  const lower = tool.toLowerCase();
  return lower.startsWith("dexlab_") ? lower.slice("dexlab_".length) : lower;
}

export function partMetadata(part: ToolPartLike): Record<string, unknown> {
  return (part.state.metadata ?? {}) as Record<string, unknown>;
}

export function isRunning(part: ToolPartLike): boolean {
  return part.state.status === "running" || part.state.status === "pending";
}

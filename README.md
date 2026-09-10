# dex-connector-ui-sdk

A harness-agnostic **agent capability SDK** that turns raw tool-call results
(builtin tools + MCP connectors) into **structured UI descriptors**. Pure
data, zero runtime dependencies, no React, no DOM rendering — the host
renders.

The pattern: *"instead of writing one component per tool, extract a
vocabulary of descriptors and let any renderer draw them."* The SDK owns the
extraction logic (the valuable, testable IP); the host owns the look.

## Install

```
npm install dex-connector-ui-sdk
```

## Public surface

| Export | Purpose |
|---|---|
| `ToolPartLike` | The minimal tool-call Part shape any harness must provide. |
| `ToolMedia` | The descriptor union — the entire contract between extractors and renderers. |
| `extractToolMedia(part, customExtractors?)` | One-call extraction: family envelopes → builtin tools → connector servers → generic MCP → JSON fallback. |
| `BUILTIN_EXTRACTORS` / `SERVER_EXTRACTORS` | The dispatch tables, exposed for extension. |
| Generic extractors | `fromRead`, `fromWebSearch`, `fromWebFetch`, `fromBash`, `fromWriteOrEdit`, `fromDiff`, `fromMcp`, `fromJsonFallback`, `fromVideoGen`. |
| Connector extractors | `fromGmailList/Detail/Editor/SendConfirm`, `fromCalendarAgenda`, `fromDriveList`, `fromSlackThread`, `fromNotesEnvelope`, `fromTasksEnvelope`. |
| Activity strip | `fromActivityBlock`, `groupActivityBlocks`, `buildActivityFrames`, `activityActionLabel`, `activityActionIcon`, `isComputerUseToolPart`, `isBrowserToolPart`. |

## Usage (any harness)

```ts
import { extractToolMedia } from "dex-connector-ui-sdk";

// On each tool result (or stream completion):
const media = extractToolMedia(toolPart);
// media === null → show your running/empty state
// media.kind === "list-card" → render with your ListCard component
// media.kind === "editor-card" → render your editor; submit is USER-initiated
// media.kind === "mcp-result" → your generic fallback
```

Extend or override dispatch per tool id:

```ts
extractToolMedia(part, {
  gmail_list_emails: (p) => myCustomGmailExtractor(p),
});
```

## Descriptor kinds

**Generic media** (host-independent): `image`, `svg`, `html`, `video`, `code`,
`diff`, `markdown`, `search-results`, `fetch`, `bash-output`, `file-read`,
`mcp-result`, `json`, `browser-selection`.

**First-party families**: `activity-strip` (Computer Use / Browser
screenshots + agent reasoning captions + action chips — the horizontal frame
strip), `notes-envelope`, `tasks-envelope`.

**Primitive vocabulary** (§3 of the Dextop connector-UI report): `list-card`,
`detail-card`, `editor-card`, `confirm-card`. Connector extractors emit these
so hosts render one component set across every connector. Later versions add
`picker-card`, `progress-card`, `table-card`, `thread-card`, `stat-strip`.

## Interaction contract (binding)

- **Editors never auto-submit.** An `editor-card` descriptor is a draft
  surface; its `primaryAction` ("Send") fires from the app when the user
  presses it — never from the model's own action. Model-initiated writes
  arrive as `confirm-card` instead.
- **Extractors return `null` on any mismatch** — never throw. A null return
  drops the host to its generic fallback render. A buggy connector extractor
  degrades one card, never the host.
- **Running/pending parts extract to `null`** so the host shows its own
  running affordance.

## Adding a connector

1. Add its result shape parser to `src/extract/connectors.ts` (parse
   metadata-first, then JSON output; return a primitive descriptor or null).
2. Register it in `SERVER_EXTRACTORS[server]` keyed by the raw tool name.
3. Add tests: happy path, mismatch → null, running → null.

## Development

```
npm install
npm test        # vitest — 41 tests
npm run lint    # tsc --noEmit
npm run build   # tsc → dist/
```

## Relationship to Dextop

The extraction logic is ported from Dextop's
`frontend/src/components/parts/tool-media.ts` +
`parts-v2/activity-grouping.ts` (pure functions only; React cards stay in the
host repo). Design context: Dextop's
`docs/plans/2026-09-06-mcp-inline-ui-handover.md`.

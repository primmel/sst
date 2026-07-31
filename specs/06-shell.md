# SST shell — the web UI host

> **Status:** normative (target). Implementation: TODO 03.

The shell is the web UI host. It owns the 2-step drill-down UX
(kinds → instances → session), the upload-a-package flow, and session
management. The bench (the running-instrument view) is embedded per
session via iframe.

## Package layout (target)

```
packages/shell/sst-shell/
  src/
    pages/
      index.astro              kinds gallery
      kind/[id].astro          instances of a kind
      session/[id].astro       session view (bench iframe)
      upload.astro             upload-a-package modal
    components/
      KindCard.vue
      InstanceCard.vue
      SamplePicker.vue
      UploadPackage.vue
      SessionTabs.vue
    lib/
      sessions.ts              session lifecycle (open / list / close)
      api.ts                   HTTP client to the runtime
      design-tokens.css        shared tokens (mirrors the bench's)
  package.json
  astro.config.mjs
```

## Routes

### `/` — kinds gallery

Lists every kind registered with the runtime. One card per kind:
- Designation (load cells / radar / dimensioner / gas analyzer)
- OIML Recommendation badge (R 60 / R 91 / R 129 / R 144)
- Instance count
- "Details" link → `/kind/<id>`

A global "Upload package…" button is available at this level for
uploading a kind package.

### `/kind/<id>` — instances of a kind

Lists every instance of the selected kind. One card per instance:
- Manufacturer + model designation
- Class badge (C6 / D1 / etc.)
- Sample count (fresh + damaged variants)
- "Open" button → opens a sample picker → starts a session

A per-kind "Upload instance…" button is available for uploading an
instance of this kind.

### `/session/<id>` — session view

Embeds the bench (`/`) of the session's runtime port via iframe. A
top-bar shows the session's instance id, a "Close session" button,
and a "New session for this instance" button.

Multiple sessions can run side-by-side in different browser tabs.

### `/upload` — upload modal

A drag-and-drop area + a file picker. The ZIP is POSTed to the
runtime's `/upload` endpoint. The response either:
- Returns a new package entry (success → the gallery refreshes).
- Returns a structured error (which file failed, which schema rule).

## HTTP API (shell → runtime)

The shell talks to the runtime via HTTP:

```
GET  /kinds                              → [{ id, title, instanceCount }]
GET  /instances?kind=<id>                → [{ id, manufacturer, model, class, samples }]
POST /sessions  { kind, instance, sample } → { sessionId, port }
DELETE /sessions/<id>
POST /upload    (multipart)              → { tier, id } | { error }
```

The runtime registers a CORS allow-list for the shell's origin so the
shell can call it cross-origin.

## Session lifecycle

1. User picks an instance + sample on `/kind/<id>`.
2. The shell calls `POST /sessions { kind, instance, sample }`.
3. The runtime boots a new SST process (or reuses a port from a
   pool) and returns `{ sessionId, port }`.
4. The shell navigates to `/session/<sessionId>`.
5. The session view embeds `http://localhost:<port>/` via iframe.
6. The user closes the session → `DELETE /sessions/<id>` → the runtime
   kills the process.

## Design tokens

The shell uses the same design tokens as the bench (Space Grotesk +
IBM Plex Sans + IBM Plex Mono, dark instrument-panel palette). The
transition shell → bench is visually seamless.

## Performance

- Initial route render is SSG (Astro pre-renders the kinds/instances
  galleries at build time, calling the runtime at build time to seed
  the cards).
- Per-session boot is the only cold path. Session iframes are
  independent; killing one doesn't affect others.
- Upload processing is server-side; the shell's UI just shows progress.

# HANDOFF: continuing erosion-workspace

Written for a fresh AI session (Claude Code, Codex, or otherwise) or a new
human contributor to pick this project up with no prior context. Read this
whole file before changing code. For the exact Grasshopper tile data format,
see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) -- that one's a narrower,
mostly-frozen reference; this file is the one that stays current.

## 1. The project in one paragraph

FAU School of Architecture, studio ARC4327 "Design 7", Assignment 2
("Proto-Architectural Spaces"). The studio built a Grasshopper/Rhino tool
that erodes a 20x20x20 ft foam block into a "tile" -- fifteen of these tiles
(three categories x five typologies: Gathering, Office, Lobby) need to be
scored against 12 studio descriptors and composed into connected,
interlocking, 3D-printable arrangements, then presented on boards.
**This repo, erosion-workspace, is the web app that does all of that**: load
or build tiles, score them, auto-generate arrangements, and export
presentation-plate PNGs.

## 2. Where this code lives: four repos, one live reference site

All under the `D7-Ryan-Dillon` GitHub org:

- **[D7-Program](https://github.com/D7-Ryan-Dillon/D7-Program)** -- **this
  repo**, erosion-workspace. The one you're working in; push to `master`
  (see section 8 for the project owner's standing instruction on that).
- **[D7-Program-9-29-Dillon](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Dillon)**
  -- the earlier prototype, `section-viewer`. Not developed further, but its
  README is still the best plain description of the *intended* behavior of
  the Viewer/Analysis/Arrange tabs -- erosion-workspace's own engines for
  those three tabs were ported and reworked from it. Key difference:
  section-viewer is 100% client-side with zero persistence; erosion-workspace
  adds the Supabase backend described in section 6.
- **[D7-Program-9-29-Ryan](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Ryan)**
  -- a data-only repo: the 48 raw face photos plus `tile-vectors.json` and
  `correction-proposals.json`. This is the source of the assets baked into
  `public/section-field/` for the **Sections** tab's tile bank.
- **[D7-Program-9-29-Ryan-pt-2](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Ryan-pt-2)**
  -- `Section-Field-main`, the **original standalone app** (a separate
  Next.js project, not a prototype of this one) that the Sections tab's
  cube/hex builder and correction editor were ported from. Its
  `lib/volume-study.ts` is the direct source of this repo's
  `lib/sections/volumeField.ts` (confirmed line-for-line equivalent as of
  this handoff, just retyped to this repo's own trace/face types -- see
  section 7 for why this matters right now). It's also live at
  **https://section-field-som.ryanjburgess1.chatgpt.site/** -- genuinely
  useful to open side-by-side with this app's Sections tab when comparing
  behavior, since it's the real original tool, not just source code.

The Grasshopper/Python tool chain that *produces* the tiles the Viewer tab
reads (`erosion_engine_5f.py`, the `.gh` file, the 15 tile recipes) lives
only on the project owner's local machine, not in any git repo -- it's not
something this app's development needs to touch. What this app needs from
it is purely the data-format contract in
[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

## 3. Stack

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4, shadcn/ui
components, three.js / `@react-three/fiber` / `@react-three/drei` for the 3D
viewports, Paper.js for the Sections tab's correction editor, canvas 2D for
the Boards tab's print-resolution composition.

## 4. The five tabs

`components/shared/TabNav.tsx` is the source of truth for tab order:
**Viewer -> Sections -> Analysis -> Arrange -> Boards**.

### Viewer (`components/viewer/`)
Drop, upload, or `.zip` a Grasshopper `_analysis` folder (via the header's
always-present "Add folder" / "Add .zip" buttons, `components/shared/
AddTilesButtons.tsx`); see it in 3D; read its metrics. `lib/ingest.ts` turns
a folder/zip into a `ParsedTile` (`lib/types.ts`), the one shape every tab
downstream works with regardless of which tab created it.

### Sections (`components/sections/`, `lib/sections/`)
A second, independent way to make a tile -- entirely in-browser, no
Grasshopper export needed. **This is where the project owner is doing
active work themselves; read section 7 before touching its core algorithm.**

- **`TileBank.tsx`** -- the bank of 48 baked-in face photos
  (`public/section-field/`) plus any new ones added, each with its best
  available 2D trace: a saved correction if the user drew one, otherwise the
  auto-trace proposal (`lib/sections/autoTrace.ts`). Corrections live in
  `localStorage` (`lib/sections/tileLibrary.ts`), not Supabase -- deliberate
  for now, see that file's own header comment.
- **`CorrectionEditor.tsx`** (`lib/sections/correctionGeometry.ts`) -- the
  Paper.js-based editor for manually fixing a trace.
- **`CubeHexBuilder.tsx`** -- assign one trace to each face of a cube or
  hexagonal prism, pick a seed and "seam fit tolerance", and generate a
  tile. Under the hood: `lib/sections/volumeField.ts` lofts the six 2D
  traces into one continuous 3D scalar field (positive = material,
  negative = void, matching the Grasshopper engine's own convention);
  `lib/sections/voxelize.ts` samples that field onto the same 40x40x40 grid
  Grasshopper tiles use; `lib/sections/mesh.ts` runs marching cubes to get a
  GLB; `lib/sections/faceData.ts` / `sectionsData.ts` build the
  Analysis-scoring-ready face/section data; `lib/sections/buildTile.ts`
  assembles all of it into a `ParsedTile`, identical in shape to one the
  Viewer tab would ingest from a real Grasshopper export (minus a few
  image-only fields that nothing in this app's scoring reads -- see that
  file's header comment for exactly which).

### Analysis (`components/analysis/`, `lib/scoring/`)
Scores the active tile against the 12 studio descriptors, works identically
regardless of which tab produced the tile. `lib/scoring/primitives.ts`
computes ~20 architectural measures (branching, porosity, compression,
layering, floor levels, etc.) from the raw tile data; `lib/scoring/
descriptors.ts` blends those into the 12 named scores.

### Arrange (`components/arrange/`, `lib/arrange/`)
Auto-generates a connected, interlocking, branching arrangement of the
tiles on the bank, with per-instance editing, joint scoring/marking, and a
"smooth & seal" CSG export. **Second area the project owner is doing active
work themselves -- see section 7.**

### Boards (`components/boards/`, `lib/boards/`)
Composes a presentation-plate layout -- an adaptive grid of tile renders
(fixed axo/perspective snapshots, `lib/boards/renderTile.ts`) with an
exact PDF-traced module frame (`lib/boards/frameShape.ts`), auto-fit text
everywhere (`lib/boards/textFit.ts`), live preview and full-resolution PNG
export sharing one drawing function (`lib/boards/exportBoard.ts`) so they
can never drift apart. Exports two PNGs: the board itself, and a second
page listing each tile's scored descriptors with its top 3 highlighted.
This tab is in good shape as of this handoff -- no known issues.

State for all five tabs lives in `lib/project-store.tsx` (React context),
gated behind a "project code" (`components/shared/ProjectGate.tsx`) --
there's no real user auth; a project is just whatever's saved under that
code string.

## 5. First-time use (for a human opening the app, or an AI describing it)

1. Enter any project code on the gate screen -- a new code starts an empty
   project, an existing one loads everything saved under it.
2. Get at least one tile onto the bank, either:
   - **Viewer tab**: drop/upload a Grasshopper `_analysis` folder or `.zip`
     (header buttons work from any tab), or
   - **Sections tab**: pick six face photos from the bank (or upload new
     ones), assign them to a cube/hex's faces in Cube/Hex Builder, and
     "Save as tile".
3. **Analysis tab**: pick a tile, check the descriptors to score (6 minimum
   per the assignment, up to all 12), read the scores.
4. **Arrange tab**: auto-generate a connected composition from the tiles on
   the bank; inspect/edit joints and instances; export.
5. **Boards tab**: pick tiles, lay out a presentation board, export the two
   PNGs.

Saving is automatic (debounced) once Supabase is configured (section 6); the
header shows a save-status indicator.

## 6. Backend: Supabase + Vercel

Provisioned 2026-09-30. Supabase project ref `rpzmpuyhudvdhxuehqit`.

- **Database**: one table, `projects` (`code text unique`, `state jsonb`) --
  see `supabase/setup.sql` for the schema and RLS policies. No real auth:
  RLS is intentionally wide open (anyone with the project code can
  read/write it), matching the "shared by code, not accounts" design.
- **Storage**: one bucket, `tile-assets` (private, RLS-gated the same way)
  -- holds each tile's `.glb` model and voxel `.u8` arrays, since those
  can't go in JSONB. Paths are `{projectCode}/{tileId}/model.glb` and
  `{projectCode}/{tileId}/voxels/{name}.bin`.
- **Client wiring**: `lib/supabase/client.ts` (browser, publishable key) and
  `lib/supabase/server.ts` (server-only, secret key -- **intentionally not
  used by anything yet**; all persistence currently happens client-side
  through RLS. Don't delete it as "unused" -- it's there for whenever a real
  API route needs privileged access).
- **Save/load**: `lib/persistence.ts` (`saveProject` / `loadProject`), wired
  into `lib/project-store.tsx` -- entering a project code loads it, editing
  the tile bank auto-saves (debounced 1.2s).
- **Not yet synced to Supabase**: the Arrange tab's generated composition
  (`ArrangeTab.tsx`'s own `assembly` state) and the Boards tab's board
  config are both local-only per browser tab right now. Entering the same
  project code elsewhere gets the same tiles, but Arrange needs
  "Auto-generate" run again (cheap) and Boards needs reconfiguring.

**Env vars** (`.env.local`, gitignored -- this is a public repo, never
commit real values): see `.env.example` for the three key names. Get actual
values from the project owner, or from the Vercel project's Environment
Variables (already set there since deploy is working). Supabase URL is
`https://rpzmpuyhudvdhxuehqit.supabase.co`; the two keys should be asked
for, not guessed.

The secret key can't be used from a browser -- Supabase blocks it with a
401 if you try. It's only ever meant to be imported in `lib/supabase/
server.ts` or another server-only file.

**Deploy**: Vercel, connected to this GitHub repo, auto-deploys on push to
`master`.

## 7. Off-limits for now: Arrange internals and the Sections lofting algorithm

**The project owner is working on these two themselves, with a
higher-effort model, because the changes needed are architecturally
significant.** Don't attempt deep fixes to either unless they explicitly
ask -- small, clearly-scoped asks (a UI tweak, a slider range, a display
label) are fine either way; it's the underlying algorithms that are
off-limits by default.

### Arrange tab
Substantially reworked in an earlier session (branching multi-socket growth
instead of linear chains, a real scale range, optional tilt rotation). Two
pieces were never confirmed working after that rework and may still need a
real by-hand test:

- **"Smooth & seal" (CSG fuse)** -- `lib/exporters/csgFuse.ts`. Compiles and
  reuses the same `instanceMatrix()` function the normal render path uses
  (reasonable evidence it's correct), but repeated attempts to click-test it
  through browser automation failed to produce a visible result or error --
  automation coordinate drift was a recurring problem, so this isn't
  necessarily broken, just unverified.
- **"Mark joint bad -> Regenerate marked"** (`components/arrange/
  JointsPanel.tsx`, `regenerateMarked()` in `lib/arrange/autoGenerate.ts`)
  -- the logic for which faces get excluded from regrowth was written and
  reasoned through carefully, but never exercised end-to-end in the browser.

### Sections tab's cube/hex lofting algorithm
`lib/sections/volumeField.ts` is a faithful, line-for-line port of
`Section-Field-main/lib/volume-study.ts` (confirmed during a comparison for
this handoff -- same math, same `fitTolerance`/`seed` parameters, same
signed-distance-field approach, only the trace/face types differ). Despite
that fidelity, **the project owner has found the geometry it produces
doesn't fill the void the way the original tool did** on real face-photo
combinations -- some cube/hex regions are left emptier than expected. This
was also independently observed earlier in this project's own history: the
algorithm's "looks fully filled" quality depends on having six genuinely
distinct, mutually compatible face traces; duplicated or incompatible faces
leave gaps. Since the port is already verified faithful to the original,
this isn't a porting bug to patch -- it's either an inherent limitation of
the blending approach that needs real redesign, or a difference in how the
*original* site's own inputs/corrections were prepared that this app hasn't
reproduced. Compare directly against
`Section-Field-main/components/volume-study.tsx` and the live site
(section 2) with the *same* face photos before changing anything here.

## 8. Standing workflow instructions from the project owner

- **Push straight to `master`.** The owner is the only one working on this
  repo right now and wants to see/test every change immediately -- no
  feature branches, no PRs, unless they say otherwise.
- Keep `npm run lint` and `npx tsc --noEmit` clean at all times.
- A two-step scaffold sometimes shows up and gets deleted repeatedly during
  Viewer-tab development: a `__devIngestFromPublic()` function in
  `lib/ingest.ts` and a matching "dev: ..." button in `UploadZone.tsx`, used
  to load a tile from `public/` without the browser's real file picker
  (which automation tools can't drive). If you add these back for testing,
  **remove them again before committing** -- temp test data got committed
  once before and had to be cleaned up.

## 9. Running it

```bash
git clone https://github.com/D7-Ryan-Dillon/D7-Program.git
cd D7-Program
npm install
cp .env.example .env.local   # then fill in real values -- ask the owner
npm run dev
```

Open http://localhost:3000 (or whatever port it picks). Without a real
`.env.local` the app still runs, it just can't save/load by project code.

`npm run lint` and `npx tsc --noEmit` should both be clean. `npm run build`
should succeed.

To get real tile data to test the Viewer tab with: the project owner has
real exports at `3d Exports/` next to this project folder (not in git) --
ask them to drag-and-drop a `<name>_analysis` folder onto the Viewer tab's
drop zone, or to share a zip of one if you're in a cloud session with no
access to their filesystem. The Sections tab needs no external data at all
-- its 48 starter photos are baked into the repo.

## 10. Suggested next steps (outside the off-limits areas in section 7)

1. Sync the Arrange assembly and Boards config to Supabase, so they follow
   a project across devices the same way the tile bank already does.
2. Persist Sections-tab corrections (currently `localStorage`-only) to
   Supabase if cross-device correction editing turns out to matter.
3. Ask the project owner what's still open before assuming the above is the
   full list -- priorities shift session to session.

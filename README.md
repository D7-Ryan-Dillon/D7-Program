# erosion-workspace

A Next.js app for the Design 7 studio project. It reads tiles exported from
the erosion Grasshopper tool chain, scores them against the studio's 12
descriptors, and auto-generates connected, interlocking arrangements of them
for export.

**Picking this project up in a new session (human or Claude)?** Start with
[HANDOFF_CLOUD.md](HANDOFF_CLOUD.md) -- it has the full project context,
current state, and known rough edges. [docs/HANDOFF.md](docs/HANDOFF.md) has
the exact data format the app reads.

## Running it

```bash
npm install
npm run dev
```

Needs a `.env.local` with three Supabase values -- see
[HANDOFF_CLOUD.md](HANDOFF_CLOUD.md) section 4. Without it the app still runs,
it just can't save/load by project code.

## Layout

```
app/                    Next.js App Router pages
components/
  shared/                Header, tab nav, logo, project-code gate
  viewer/                 3D viewport, upload zone, metrics legend
  analysis/               Descriptor scoring UI
  arrange/                Bank, settings, joints, viewport, per-piece editing
lib/
  types.ts               Typed shapes for the exported tile bundle
  ingest.ts               Turns a dropped folder/.zip into a ParsedTile
  scoring/                The 12-descriptor scoring engine (Analysis tab)
  arrange/                Auto-generate, matching, joints, regrowth (Arrange tab)
  persistence.ts          Save/load a project by code, via Supabase
  supabase/               Supabase client setup (browser + server-only)
supabase/setup.sql        Run once in the Supabase SQL Editor for a fresh project
```

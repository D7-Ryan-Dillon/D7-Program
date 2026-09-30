# HANDOFF: continuing erosion-workspace in a Claude Code cloud session

Written 2026-09-30 so a fresh Claude Code session (cloud or local) has everything
it needs without the person having to re-explain the project. Read this first,
then [docs/HANDOFF.md](docs/HANDOFF.md) for the exact data format this app reads.

## 1. The project in one paragraph

FAU architecture studio ARC4327, Design 7, Assignment 2 ("Proto-Architectural
Spaces"). The studio built a Grasshopper/Rhino tool that erodes a 20x20x20 ft
foam block into a "tile" -- fifteen of these tiles (three categories x five
typologies) need to be scored against 12 studio descriptors and composed into
one connected, interlocking, 3D-printable arrangement. **This repo,
erosion-workspace, is the web app that does that**: load tiles, score them,
auto-generate arrangements, export. It replaced an earlier prototype
(section-viewer, see section 3) that proved the concept but ran entirely
client-side with no persistence.

## 2. Where this code lives, and what's what

Two repos exist under the `D7-Ryan-Dillon` GitHub org:

- **[D7-Program](https://github.com/D7-Ryan-Dillon/D7-Program)** -- **this repo**,
  erosion-workspace. This is the one you're working in and should push to.
- **[D7-Program-9-29-Dillon](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Dillon)**
  -- the earlier prototype, `section-viewer`. Not being developed further, but
  read it if you need to see how the original Arrange/Analysis engines worked --
  erosion-workspace's own engines were ported and reworked from it (see its
  README.md for a full feature description; it's a good, accurate description of
  the *intended* behavior of the Viewer/Analysis/Arrange tabs, since erosion-workspace
  was built to match it and then extend it). The biggest functional difference:
  section-viewer is 100% client-side with zero persistence ("Nothing here
  touches a server or database"); erosion-workspace adds the Supabase backend
  described below.

The Grasshopper/Python tool chain that *produces* the tiles this app reads
(`erosion_engine_5f.py`, the `.gh` file, the 15 tile recipes) lives only on the
person's local machine, not in any git repo -- it's not something this app's
development needs to touch. What this app *does* need from that tool chain is
purely the data-format contract, which is fully captured in
[docs/HANDOFF.md](docs/HANDOFF.md) (copied into this repo so it's always
available, not just on one machine). If you ever need real sample tile data to
test with and none is loaded, ask the person to drag-and-drop a `<name>_analysis`
folder onto the Viewer tab -- don't try to fetch it from anywhere, it only
exists locally on their machine.

## 3. Stack and architecture

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4, shadcn/ui
components, three.js/@react-three/fiber for the 3D viewports. Three tabs:

- **Viewer** (`components/viewer/`) -- drop/upload a tile, see it in 3D, read
  its metrics.
- **Analysis** (`components/analysis/`, `lib/scoring/`) -- scores the active
  tile against 12 descriptors. `lib/scoring/primitives.ts` computes ~20
  architectural measures (branching, porosity, compression, layering, floor
  levels, etc.) from the raw tile data; `lib/scoring/descriptors.ts` blends
  those into the 12 named scores.
- **Arrange** (`components/arrange/`, `lib/arrange/`) -- **see section 5, this
  is the least finished part of the app.**

State lives in `lib/project-store.tsx` (React context), gated behind a
"project code" (`components/shared/ProjectGate.tsx`) -- there's no real user
auth, a project is just whatever's saved under that code string. See
[docs/HANDOFF.md](docs/HANDOFF.md) for the exact tile data format
(`lib/types.ts` mirrors it directly).

## 4. Backend: Supabase + Vercel

Provisioned 2026-09-30. Project ref `rpzmpuyhudvdhxuehqit`.

- **Database**: one table, `projects` (`code text unique`, `state jsonb`) --
  see `supabase/setup.sql` for the exact schema and RLS policies. No real
  auth: RLS is intentionally wide open (anyone with the project code can
  read/write it), matching the "shared by code, not accounts" design.
- **Storage**: one bucket, `tile-assets` (private, RLS-gated same as above) --
  holds each tile's `.glb` model and voxel `.u8` arrays, since those can't go
  in JSONB. Paths are `{projectCode}/{tileId}/model.glb` and
  `{projectCode}/{tileId}/voxels/{name}.bin`.
- **Client wiring**: `lib/supabase/client.ts` (browser, publishable key) and
  `lib/supabase/server.ts` (server-only, secret key -- not actually used by
  anything yet, since all current persistence happens client-side through RLS;
  it's there for whenever a real API route needs privileged access).
- **Save/load logic**: `lib/persistence.ts` (`saveProject` / `loadProject`),
  wired into `lib/project-store.tsx` -- entering a project code loads it,
  editing the tile bank auto-saves (debounced 1.2s) with a status indicator in
  the header.

**Known outstanding step**: `supabase/setup.sql` in this repo includes UPDATE
and DELETE policies on `storage.objects` that were added *after* the
table/bucket were first created in the person's dashboard (found live during
this session's testing -- re-saving an already-saved project's assets failed
with `"new row violates row-level security policy"`, a 400 from Storage,
because upsert-over-an-existing-object is an UPDATE under the hood, and only
INSERT/SELECT policies existed at first). Postgres has no
`CREATE POLICY IF NOT EXISTS`, so re-running the whole file will error on the
policies that already exist -- if you hit that RLS error, just give the person
these two statements to run by themselves in the Supabase SQL Editor:
```sql
create policy "anyone can overwrite tile assets" on storage.objects for update
  using (bucket_id = 'tile-assets');
create policy "anyone can delete tile assets" on storage.objects for delete
  using (bucket_id = 'tile-assets');
```
Check first (`supabase/setup.sql` in this repo already has them) -- this note
is only relevant if the person's actual Supabase project is still missing them.

**Env vars** (`.env.local`, gitignored -- never commit these, this is a public
repo): three values, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`. Get them
from the person directly, from their own `.env.local`, or from the Vercel
project's Environment Variables (Settings -> Environment Variables) -- they're
already set there since deploy is working. The Supabase project ref is
`rpzmpuyhudvdhxuehqit`, so the URL is `https://rpzmpuyhudvdhxuehqit.supabase.co`;
the two keys should be asked for, not guessed or reconstructed.

The secret key deliberately can't be used from a browser -- Supabase itself
blocks it with a 401 "Forbidden use of secret API key in browser" if you try.
It's only ever meant to be imported in `lib/supabase/server.ts` or another
server-only file. Never paste either key into a file that gets committed.

**Deploy**: Vercel, connected to the `D7-Program` GitHub repo, auto-deploys on
push to `master`. The person set this up manually through vercel.com's import
flow (not the CLI) with the three env vars above pasted in via "Import .env".

## 5. What's NOT done / known rough edges

**Arrange is the least finished tab -- treat it as a work in progress, not a
finished feature.** It was substantially reworked this session (branching
multi-socket growth instead of linear chains, a real scale range, optional
tilt rotation alongside the always-on vertical rotation, and fixed so the
"amount" slider is actually honored -- verified live at ~600ms for 20 pieces
with tilt+scale on, well under the 3-5s target). But two pieces were never
confirmed working after that rework:

- **"Smooth & seal" (CSG fuse)** -- `lib/exporters/csgFuse.ts`. It compiles and
  reuses the same `instanceMatrix()` function the normal (already-verified)
  render path uses, which is reasonable evidence it's correct, but repeated
  attempts to click-test it through browser automation failed to produce any
  visible result or error (not necessarily broken -- automation coordinate
  drift was a recurring problem all session). **Needs a real, by-hand click
  test.**
- **"Mark joint bad -> Regenerate marked"** (`components/arrange/JointsPanel.tsx`,
  `regenerateMarked()` in `lib/arrange/autoGenerate.ts`) -- the underlying logic
  (which faces get excluded from regrowth so survivors don't get duplicate
  neighbors) was written and reasoned through carefully, but never exercised
  end-to-end in the browser before testing was interrupted.

Also **not synced to Supabase yet**: only the Viewer's tile bank persists.
The Arrange tab's generated composition (`ArrangeTab.tsx`'s own `assembly`
state) is still local-only per browser tab -- entering the same project code
on another device gets you the same tiles, but you'd need to hit
**Auto-generate** again to get an arrangement (which is cheap -- see above).
Wiring that up too is a reasonable next step, but wasn't done here to avoid
touching Arrange's internals further while it's still this unsettled.

Two bits of temporary scaffolding show up and get deleted repeatedly during
development: a `__devIngestFromPublic()` function in `lib/ingest.ts` and a
matching "dev: ..." button in `UploadZone.tsx`, used to load a tile from
`public/` without going through the browser's real file picker (which
automation tools can't drive). **If you add these back for testing, remove
them again before committing** -- this has bitten past sessions (temp test
data got committed once and had to be cleaned up).

## 6. Running it

```bash
git clone https://github.com/D7-Ryan-Dillon/D7-Program.git
cd D7-Program
npm install
```

Create `.env.local` with the three values from section 4, then:

```bash
npm run dev
```

Open http://localhost:3000 (or whatever port it picks). `npm run lint` and
`npx tsc --noEmit` should both be clean at all times -- keep them that way.

To get real tile data to test with: the person has real exports at
`3d Exports/` next to this project folder (not in git) -- ask them to
drag-and-drop a `<name>_analysis` folder onto the Viewer tab's drop zone, or
to share a zip of one with you if you're in a cloud session with no access to
their filesystem.

## 7. Suggested next steps, roughly in order

1. Verify the two Arrange rough edges in section 5 by hand (CSG fuse, mark-bad
   + regenerate).
2. Decide whether to sync the Arrange assembly to Supabase too, or leave
   auto-generate as a cheap, per-device action.
3. The person mentioned "edits and bugs to fix" they were already tracking
   before this backend/deploy detour -- ask them what's still open before
   assuming the above is the full list.

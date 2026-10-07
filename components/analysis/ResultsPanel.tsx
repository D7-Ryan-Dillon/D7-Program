"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/shared/Section";
import { Segmented } from "@/components/shared/Segmented";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/analysis/MatrixCard";
import { downloadTextFile } from "@/lib/exporters/objExport";
import { downloadBlob } from "@/lib/boards/exportBoard";
import { paletteStyle, usePalette } from "@/lib/boardPalette";
import { PaletteEditor } from "@/components/shared/PaletteEditor";
import type { Ground } from "@/lib/drawing/render";
import { shortName } from "@/lib/scoring/compare";
import { MATRIX, type MatrixKey } from "@/lib/scoring/matrix";
import { defaultTableOptions, descriptorDiagram, diagramSheet, resultsBoard, resultsCsv, type ResultRow, type TableOptions } from "@/lib/scoring/exportResults";
import { useProjectUi } from "@/lib/project-store";
import { FontField } from "@/components/boards/FontField";
import { defaultBoardConfig } from "@/lib/boards/types";
import { interpretationFor } from "@/lib/scoring/profile";
import { useEvaluation } from "@/lib/useEvaluation";
import type { ParsedTile } from "@/lib/types";

/** What the table export holds: saved with the project. */
interface TableUi {
  opts: TableOptions;
  /** the tiles in the table (null: every tile) */
  tileIds: string[] | null;
  /** the descriptors in the table (null: the ones this project carries forward) */
  keys: MatrixKey[] | null;
}
/** Only the font of the Boards tab is read from the boards settings: every export starts in it. */
const defaultBoardsFont = () => ({ config: { fontFamily: defaultBoardConfig().fontFamily } });
const defaultTableUi = (): TableUi => ({ opts: defaultTableOptions(), tileIds: null, keys: null });
const numInput = "h-7 w-16 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-[11px] text-foreground";

/** The Analysis as things to hand in: every tile against the carried criteria (on screen, CSV, image), and an annotated diagram per descriptor for the
 * tile being read (the plan or section with the measure drawn on it, with the value, its status and the reading). Everything comes from the same
 * evaluation as the Analysis tab and the Boards sheets, so the three agree. */
export function ResultsPanel({ tiles, keys, activeTile }: { tiles: ParsedTile[]; keys: MatrixKey[]; activeTile: ParsedTile | undefined }) {
  const ev = useEvaluation();
  const { profile, evaluate } = ev;
  const [ground, setGround] = useState<Ground>("paper");
  const [which, setWhich] = useState<string>("all");
  const [imgScale, setImgScale] = useState(2);
  const [tui, setTui] = useProjectUi<TableUi>("resultsTable", defaultTableUi);
  const [boards] = useProjectUi<{ config: { fontFamily: string } }>("boards", defaultBoardsFont);
  const boardFont = boards.config.fontFamily;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [palette] = usePalette();
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo<ResultRow[]>(
    () =>
      tiles.map((tile) => ({
        tile,
        ev: evaluate(tile),
        reading: (r) => interpretationFor(profile, tile.id, r).text,
      })),
    [tiles, evaluate, profile],
  );
  const names = new Map(MATRIX.map((m) => [m.key, m.name]));
  const opts = tui.opts;
  const patchOpts = (p: Partial<TableOptions>) => setTui((prev) => ({ ...prev, opts: { ...prev.opts, ...p } }));
  const chosenKeys = (tui.keys ?? keys).filter((k) => MATRIX.some((m) => m.key === k));
  const chosenRows = tui.tileIds ? rows.filter((r) => tui.tileIds!.includes(r.tile.id)) : rows;
  const toggleKey = (k: MatrixKey) => setTui((prev) => {
    const cur = prev.keys ?? keys;
    return { ...prev, keys: MATRIX.map((m) => m.key).filter((x) => (x === k ? !cur.includes(x) : cur.includes(x))) };
  });
  const toggleTile = (id: string) => setTui((prev) => {
    const cur = prev.tileIds ?? rows.map((r) => r.tile.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { ...prev, tileIds: next.length === rows.length ? null : next };
  });

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't write that file.");
    } finally {
      setBusy(false);
    }
  };

  const g = custom ? paletteStyle(palette) : ground;
  // the live preview of the table image, drawn a moment after the last change
  const previewKey = JSON.stringify([opts, boardFont, chosenKeys, chosenRows.map((r) => r.tile.id), ground, custom, palette]);
  useEffect(() => {
    if (!chosenRows.length || !chosenKeys.length) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const blob = await resultsBoard(chosenRows, chosenKeys, g, { ...opts, font: opts.font || boardFont, dpi: Math.max(20, Math.min(70, 1000 / opts.widthIn)), format: "png" });
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch {
        /* the preview is only a convenience */
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  if (!rows.length) return null;
  const active = rows.find((r) => r.tile.id === activeTile?.id) ?? rows[0];

  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.results" title="Results" summary={`${tiles.length} tile${tiles.length === 1 ? "" : "s"} · ${keys.length} criteria`}>
        <p className="text-[11px] text-muted-foreground">Every tile against the criteria this project carries forward: the measured value with its unit, how it was obtained, and the reading. The table and the diagrams are what you put on a board or in the write-up.</p>

        <div className="overflow-x-auto rounded-md border-hair">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Tile</th>
                {keys.map((k) => (
                  <th key={k} className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                    {names.get(k) ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tile, ev: te, reading }) => (
                <tr key={tile.id} className="border-b border-border/60 align-top last:border-0">
                  <td className="max-w-[11rem] px-2.5 py-2 font-medium">{shortName(tile)}</td>
                  {keys.map((k) => {
                    const r = te.results.find((x) => x.key === k);
                    return (
                      <td key={k} className="max-w-[16rem] px-2.5 py-2">
                        {r && (
                          <>
                            <div className="font-mono text-[11px] leading-snug text-foreground">{r.measure.headline}</div>
                            <div className="mt-0.5">
                              <StatusBadge status={r.measure.status} />
                            </div>
                            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{reading(r)}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadTextFile("results.csv", resultsCsv(chosenRows, chosenKeys), "text/csv")}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Table (CSV)
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !chosenRows.length || !chosenKeys.length} onClick={() => void run(async () => downloadBlob(`results_table.${opts.format === "jpeg" ? "jpg" : "png"}`, await resultsBoard(chosenRows, chosenKeys, g, { ...opts, font: opts.font || boardFont })))}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Table (image)
          </Button>
          <Segmented value={ground} options={[{ value: "paper", label: "Paper" }, { value: "dark", label: "Dark" }]} onChange={setGround} />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Use the project's own colours (set under Colours) instead of Paper / Dark">
            <input type="checkbox" className="accent-[var(--magenta)]" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
            My colours
          </label>
          <Select className="h-7 w-28 text-[11px]" value={String(imgScale)} onChange={(e) => setImgScale(Number(e.target.value))} aria-label="Image resolution">
            <option value="1">1× size</option>
            <option value="2">2× size</option>
            <option value="3">3× size</option>
            <option value="4">4× size</option>
          </Select>
        </div>

        <Section id="analysis.tableEditor" variant="inline" title="Edit the table image" summary={`${chosenRows.length} tile${chosenRows.length === 1 ? "" : "s"} · ${chosenKeys.length} descriptor${chosenKeys.length === 1 ? "" : "s"} · ${opts.widthIn} × ${opts.heightIn} in`} bodyClassName="space-y-3">
          <p className="text-[11px] text-muted-foreground">Choose what is in the image, how big it is and how it is drawn. The preview below is what &ldquo;Table (image)&rdquo; exports (and the CSV holds the same tiles and descriptors).</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                Tiles
                <span className="flex gap-1">
                  <button type="button" className="hover:text-foreground" onClick={() => setTui((p) => ({ ...p, tileIds: null }))}>all</button>
                  <button type="button" className="hover:text-foreground" onClick={() => setTui((p) => ({ ...p, tileIds: [] }))}>none</button>
                </span>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
                {rows.map((r) => (
                  <label key={r.tile.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input type="checkbox" className="accent-[var(--magenta)]" checked={chosenRows.some((x) => x.tile.id === r.tile.id)} onChange={() => toggleTile(r.tile.id)} />
                    {shortName(r.tile)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                Descriptors
                <span className="flex gap-1">
                  <button type="button" className="hover:text-foreground" onClick={() => setTui((p) => ({ ...p, keys: MATRIX.map((m) => m.key) }))}>all</button>
                  <button type="button" className="hover:text-foreground" onClick={() => setTui((p) => ({ ...p, keys: null }))} title="The descriptors this project carries forward">carried</button>
                  <button type="button" className="hover:text-foreground" onClick={() => setTui((p) => ({ ...p, keys: [] }))}>none</button>
                </span>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
                {MATRIX.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input type="checkbox" className="accent-[var(--magenta)]" checked={chosenKeys.includes(m.key)} onChange={() => toggleKey(m.key)} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">Each cell shows</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {([["bar", "a bar"], ["result", "the measured result"], ["status", "its status"], ["reading", "the reading"], ["method", "how it was measured"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.content[k]} onChange={(e) => patchOpts({ content: { ...opts.content, [k]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.showTitle} onChange={(e) => patchOpts({ showTitle: e.target.checked })} />
              Title
            </label>
            <input value={opts.title} onChange={(e) => patchOpts({ title: e.target.value })} className="h-7 w-48 rounded-md border border-input bg-transparent px-2 text-[11px] text-foreground" aria-label="Title" />
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.tilesAcross} onChange={(e) => patchOpts({ tilesAcross: e.target.checked })} />
              Tiles across the top
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.showTileNames} onChange={(e) => patchOpts({ showTileNames: e.target.checked })} />
              Tile names
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.showType} onChange={(e) => patchOpts({ showType: e.target.checked })} />
              Category and type
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.grid} onChange={(e) => patchOpts({ grid: e.target.checked })} />
              Grid lines
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--magenta)]" checked={opts.transparent} onChange={(e) => patchOpts({ transparent: e.target.checked })} />
              Transparent background (PNG)
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            Size
            <input type="number" min={4} max={80} step={0.5} value={opts.widthIn} onChange={(e) => patchOpts({ widthIn: Math.max(4, Math.min(80, Number(e.target.value) || opts.widthIn)) })} className={numInput} aria-label="Width in inches" />
            ×
            <input type="number" min={3} max={80} step={0.5} value={opts.heightIn} onChange={(e) => patchOpts({ heightIn: Math.max(3, Math.min(80, Number(e.target.value) || opts.heightIn)) })} className={numInput} aria-label="Height in inches" />
            in at
            <Select className="h-7 w-24 text-[11px]" value={String(opts.dpi)} onChange={(e) => patchOpts({ dpi: Number(e.target.value) })} aria-label="Resolution">
              {[72, 100, 150, 200, 300].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </Select>
            <span className="font-mono">{Math.round(opts.widthIn * opts.dpi)} × {Math.round(opts.heightIn * opts.dpi)} px</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patchOpts({ widthIn: 22, heightIn: 11 })}>22 × 11</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patchOpts({ widthIn: 11, heightIn: 8.5 })}>11 × 8.5</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => patchOpts({ widthIn: 53.33, heightIn: 30, dpi: 72 })} title="16:9 for a TV: 3840 × 2160 px">TV 4K</Button>
            <label className="flex items-center gap-1.5">
              Text size
              <input type="range" min={60} max={160} step={5} value={Math.round(opts.fontScale * 100)} onChange={(e) => patchOpts({ fontScale: Number(e.target.value) / 100 })} className="w-24 accent-[var(--magenta)]" />
            </label>
            <div className="w-64"><FontField value={opts.font ?? ""} defaultFont={boardFont} onChange={(font) => patchOpts({ font })} /></div>
            <Segmented value={opts.format} options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} onChange={(format) => patchOpts({ format })} />
          </div>
          <div className="flex min-h-24 items-center justify-center overflow-auto rounded-md border-hair bg-black/30 p-2">
            {previewUrl && chosenRows.length && chosenKeys.length ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview of the table image" className="max-h-80 max-w-full rounded-sm border border-white/15" />
            ) : (
              <span className="text-[11px] text-muted-foreground">Tick at least one tile and one descriptor.</span>
            )}
          </div>
        </Section>

        <details className="rounded-md border-hair px-3 py-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Colours for the images (turn on “My colours”)</summary>
          <div className="pt-2">
            <PaletteEditor />
          </div>
        </details>

        <Section id="analysis.diagrams" variant="inline" title="Annotated diagrams" summary={shortName(active.tile)} bodyClassName="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            For {shortName(active.tile)}: a plan or section with the measure lit (rooms, floors, the route), the matrix&apos;s own words, the value with its status, and the reading.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="h-7 w-56 text-[11px]" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Which diagram">
              <option value="all">All twelve, one sheet</option>
              {MATRIX.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const stem = active.tile.name;
                  if (which === "all") downloadBlob(`${stem}_diagrams.png`, await diagramSheet(active.tile, active.ev.results, active.reading, g, imgScale));
                  else {
                    const r = active.ev.results.find((x) => x.key === which);
                    if (r) downloadBlob(`${stem}_${r.key}.png`, await descriptorDiagram(active.tile, r, active.reading(r), g, imgScale));
                  }
                })
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {busy ? "Drawing..." : "Diagram (image)"}
            </Button>
          </div>
        </Section>
      </Section>
    </div>
  );
}

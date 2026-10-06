"use client";

import { useMemo, useState } from "react";
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
import { descriptorDiagram, diagramSheet, resultsCsv, resultsImage, type ResultRow } from "@/lib/scoring/exportResults";
import { interpretationFor } from "@/lib/scoring/profile";
import { useEvaluation } from "@/lib/useEvaluation";
import type { ParsedTile } from "@/lib/types";

/** The Analysis as things to hand in: every tile against the carried criteria (on screen, CSV, image), and an annotated diagram per descriptor for the
 * tile being read (the plan or section with the measure drawn on it, with the value, its status and the reading). Everything comes from the same
 * evaluation as the Analysis tab and the Boards sheets, so the three agree. */
export function ResultsPanel({ tiles, keys, activeTile }: { tiles: ParsedTile[]; keys: MatrixKey[]; activeTile: ParsedTile | undefined }) {
  const ev = useEvaluation();
  const { profile, evaluate } = ev;
  const [ground, setGround] = useState<Ground>("paper");
  const [which, setWhich] = useState<string>("all");
  const [imgScale, setImgScale] = useState(2);
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

  if (!rows.length) return null;
  const active = rows.find((r) => r.tile.id === activeTile?.id) ?? rows[0];
  const g = custom ? paletteStyle(palette) : ground;

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
          <Button variant="outline" size="sm" onClick={() => downloadTextFile("results.csv", resultsCsv(rows, keys), "text/csv")}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Table (CSV)
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => downloadBlob("results_table.png", await resultsImage(rows, keys, g, imgScale)))}>
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

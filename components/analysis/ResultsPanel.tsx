"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/shared/Section";
import { Segmented } from "@/components/shared/Segmented";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { downloadTextFile } from "@/lib/exporters/objExport";
import { downloadBlob } from "@/lib/boards/exportBoard";
import type { Ground } from "@/lib/drawing/render";
import { shortName } from "@/lib/scoring/compare";
import { DESCRIPTOR_META, type DescriptorKey } from "@/lib/scoring/descriptors";
import { descriptorDiagram, diagramSheet, resultsCsv, resultsImage } from "@/lib/scoring/exportResults";
import { scoreTileCached } from "@/lib/scoring/selection";
import type { ParsedTile } from "@/lib/types";

/** The Analysis as things to hand in: every tile against the carried criteria (on screen, CSV, image), and an annotated diagram
 * per descriptor for the tile being read (the plan or section with the measure drawn on it, with the score and the sentence). */
export function ResultsPanel({ tiles, keys, activeTile }: { tiles: ParsedTile[]; keys: DescriptorKey[]; activeTile: ParsedTile | undefined }) {
  const [ground, setGround] = useState<Ground>("paper");
  const [which, setWhich] = useState<string>("all");
  const [imgScale, setImgScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => tiles.map((tile) => ({ tile, results: scoreTileCached(tile) })), [tiles]);
  const labels = new Map(DESCRIPTOR_META.map((m) => [m.key, m.label]));

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

  return (
    <div className="glass-panel rounded-lg">
      <Section id="analysis.results" title="Results" summary={`${tiles.length} tile${tiles.length === 1 ? "" : "s"} · ${keys.length} criteria`}>
        <p className="text-[11px] text-muted-foreground">Every tile against the criteria this project carries forward: the score, the qualitative reading and the measure behind it. The table and the diagrams are what you put on a board or in the write-up.</p>

        <div className="overflow-x-auto rounded-md border-hair">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground">Tile</th>
                {keys.map((k) => (
                  <th key={k} className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                    {labels.get(k) ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tile, results }) => (
                <tr key={tile.id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="max-w-[11rem] px-2.5 py-2 font-medium">{shortName(tile)}</td>
                  {keys.map((k) => {
                    const r = results.find((x) => x.key === k);
                    return (
                      <td key={k} className="max-w-[12rem] px-2.5 py-2">
                        {r && (
                          <>
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-mono text-sm tabular-nums">{r.score}</span>
                              <span className="text-[11px] text-magenta">{r.qualitative.reading}</span>
                            </div>
                            <div className="font-mono text-[10px] leading-snug text-muted-foreground">{r.quant.headline}</div>
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
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => downloadBlob("results_table.png", await resultsImage(rows, keys, ground, imgScale)))}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Table (image)
          </Button>
          <Segmented value={ground} options={[{ value: "paper", label: "Paper" }, { value: "dark", label: "Dark" }]} onChange={setGround} />
          <Select className="h-7 w-28 text-[11px]" value={String(imgScale)} onChange={(e) => setImgScale(Number(e.target.value))} aria-label="Image resolution">
            <option value="1">1× size</option>
            <option value="2">2× size</option>
            <option value="3">3× size</option>
            <option value="4">4× size</option>
          </Select>
        </div>

        <Section id="analysis.diagrams" variant="inline" title="Annotated diagrams" summary={shortName(active.tile)} bodyClassName="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            For {shortName(active.tile)}: a plan or section with the measure lit (rooms, floors, the route), the score, the quantity and the sentence beside it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="h-7 w-48 text-[11px]" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Which diagram">
              <option value="all">All twelve, one sheet</option>
              {DESCRIPTOR_META.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
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
                  if (which === "all") downloadBlob(`${stem}_diagrams.png`, await diagramSheet(active.tile, active.results, ground, imgScale));
                  else {
                    const r = active.results.find((x) => x.key === which);
                    if (r) downloadBlob(`${stem}_${r.key}.png`, await descriptorDiagram(active.tile, r, ground, imgScale));
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

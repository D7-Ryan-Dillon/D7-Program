"use client";

import { useMemo, useState } from "react";
import { Download, Eye, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { downloadTextFile } from "@/lib/exporters/objExport";
import { INTERLOCK_COUNTS, INTERLOCK_PATTERNS, interlockCsv, runAllInterlock, runInterlock, type InterlockCount, type InterlockPattern, type InterlockResult } from "@/lib/arrange/interlock";
import { pairMatrix, scoreColor, type PairMatrix } from "@/lib/arrange/pairMatrix";
import { isPlaceable } from "@/lib/arrange/orient";
import { makePiece } from "@/lib/arrange/ops";
import { Cap, Chip } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";
import { emptyDoc } from "@/lib/arrange/types";

const SCORE = (v: number | null) => (v === null ? "sealed" : v.toFixed(0));

/** The assignment's interlock test as a button (repeat, mirror, shift; 2, 4, 8 copies), and the heat map of which tiles meet well. */
export function TestsPanel() {
  const A = useArrange();
  const placeable = useMemo(() => A.tiles.filter(isPlaceable), [A.tiles]);
  const selTile = A.sel.size === 1 ? A.doc.pieces.find((p) => p.id === [...A.sel][0])?.tileId : undefined;
  const [tileId, setTileId] = useState<string>("");
  const tile = A.tileById.get(tileId || selTile || placeable[0]?.id || "");
  const [pattern, setPattern] = useState<InterlockPattern>("repeat");
  const [count, setCount] = useState<InterlockCount>(2);
  const [result, setResult] = useState<InterlockResult | null>(null);
  const [table, setTable] = useState<InterlockResult[] | null>(null);
  const [matrix, setMatrix] = useState<PairMatrix | null>(null);
  const [working, setWorking] = useState(false);

  if (!placeable.length) return <p className="text-xs text-muted-foreground">Load tiles in the Viewer tab first.</p>;

  const run = () => {
    if (!tile) return;
    const r = runInterlock(tile, pattern, count, A.ui.rules);
    setResult(r);
    A.setInterlock({ doc: r.doc, label: `${tile.name}: ${pattern} × ${count}` });
    A.refit();
  };
  const runAll = () => {
    if (!tile) return;
    setWorking(true);
    setTimeout(() => {
      setTable(runAllInterlock(tile, A.ui.rules));
      setWorking(false);
    }, 20);
  };
  const compute = () => {
    setWorking(true);
    setTimeout(() => {
      setMatrix(pairMatrix(placeable));
      setWorking(false);
    }, 20);
  };

  const clickCell = (a: number, b: number) => {
    if (!matrix) return;
    const A0 = matrix.tiles[a];
    const B0 = matrix.tiles[b];
    const cell = matrix.cells[a][b];
    if (!A.doc.pieces.length) {
      const pa = makePiece(emptyDoc(), A0.id, [0, 0, 0]);
      const pb = makePiece({ ...emptyDoc(), pieces: [pa] }, B0.id, cell.pos, { rotZ: cell.rotZ, mirrorX: cell.mirrorX });
      A.tryCommit({ ...emptyDoc(), pieces: [pa, pb] }, "Add pair");
      A.refit();
      return;
    }
    // with an arrangement open: put B beside the selected piece (or anywhere it makes a walkable joint)
    A.addTile(B0.id);
  };

  const sel = (v: string, set: (s: string) => void, label: string, opts: { v: string; l: string }[]) => (
    <Select className="h-7 flex-1 text-[11px]" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Cap>Interlock test</Cap>
        {sel(tile?.id ?? "", setTileId, "Tile to test", placeable.map((t) => ({ v: t.id, l: t.name })))}
        <div className="flex gap-2">
          {sel(pattern, (v) => setPattern(v as InterlockPattern), "Pattern", INTERLOCK_PATTERNS.map((p) => ({ v: p, l: p[0].toUpperCase() + p.slice(1) })))}
          {sel(String(count), (v) => setCount(Number(v) as InterlockCount), "Copies", INTERLOCK_COUNTS.map((c) => ({ v: String(c), l: `${c} copies` })))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={run} disabled={!tile}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Run
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={runAll} disabled={!tile || working}>
            {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Test all patterns
          </Button>
        </div>
        {result && (
          <div className="rounded-md border-hair p-2 text-[11px]">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">
                {result.pattern} × {result.count}
              </span>
              <span className="font-mono text-foreground">{SCORE(result.overall)}</span>
            </div>
            <div className="text-muted-foreground">
              {result.joints} joints · worst {SCORE(result.worst)} · {result.connected ? "connected" : "not connected"}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Chip onClick={() => A.setInterlock(null)}>
                <Eye className="mr-1 inline h-3 w-3" />
                Close preview
              </Chip>
              <Chip
                onClick={() => {
                  A.setInterlock(null);
                  A.tryCommit(result.doc, "Use test");
                  A.refit();
                }}
                title="Make this test the working arrangement"
              >
                Use as arrangement
              </Chip>
            </div>
          </div>
        )}
        {table && tile && (
          <div className="space-y-1.5">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-label text-muted-foreground">
                  <th className="py-1">Pattern</th>
                  {INTERLOCK_COUNTS.map((c) => (
                    <th key={c} className="text-right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INTERLOCK_PATTERNS.map((p) => (
                  <tr key={p} className="border-t border-border">
                    <td className="py-1 capitalize">{p}</td>
                    {INTERLOCK_COUNTS.map((c) => {
                      const r = table.find((x) => x.pattern === p && x.count === c);
                      return (
                        <td key={c} className="text-right font-mono" style={{ color: scoreColor(r?.overall ?? null) }}>
                          {SCORE(r?.overall ?? null)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" variant="outline" className="w-full" onClick={() => downloadTextFile(`${tile.name}_interlock.csv`, interlockCsv(tile, table), "text/csv")}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export table (CSV)
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <Cap>Pair matrix</Cap>
          <Button size="sm" variant="outline" className="h-7" onClick={compute} disabled={working}>
            {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {matrix ? "Recompute" : "Compute"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Best joint of the column tile beside the row tile (over its eight orientations). Click a cell to add that pair.</p>
        {matrix && (
          <div className="overflow-x-auto">
            <div className="inline-grid gap-px" style={{ gridTemplateColumns: `repeat(${matrix.tiles.length + 1}, minmax(14px, 1fr))` }}>
              <span />
              {matrix.tiles.map((t, i) => (
                <span key={t.id} className="truncate px-0.5 text-center font-mono text-[8px] text-muted-foreground" title={t.name}>
                  {i + 1}
                </span>
              ))}
              {matrix.tiles.map((a, i) => (
                <PairRow key={a.id} index={i} name={a.name} cells={matrix.cells[i]} onClick={(j) => clickCell(i, j)} />
              ))}
            </div>
          </div>
        )}
        {matrix && (
          <ol className="grid grid-cols-1 gap-x-3 text-[10px] text-muted-foreground sm:grid-cols-2">
            {matrix.tiles.map((t, i) => (
              <li key={t.id} className="truncate">
                <span className="font-mono">{i + 1}</span> {t.name}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function PairRow({ index, name, cells, onClick }: { index: number; name: string; cells: PairMatrix["cells"][number]; onClick: (j: number) => void }) {
  return (
    <>
      <span className="pr-1 text-right font-mono text-[8px] text-muted-foreground" title={name}>
        {index + 1}
      </span>
      {cells.map((c, j) => (
        <button key={j} type="button" onClick={() => onClick(j)} title={`${SCORE(c.score)}`} className="aspect-square min-h-[14px] rounded-[2px] hover:ring-1 hover:ring-white/60" style={{ backgroundColor: scoreColor(c.score) }} />
      ))}
    </>
  );
}

"use client";

// Ported from Section-Field's research/correction-editor/editor.js -- the
// "cleanup and add screen" for manually correcting a tile's auto-traced
// vector silhouette (add mass, subtract void, erase, drag anchors, undo/
// redo, zoom/pan). The original drove the DOM imperatively and persisted
// through postMessage + IndexedDB (it was embedded in an iframe); this is
// the same tool set and interaction model rebuilt as a normal React
// component, with the host (lib/sections' tile bank) owning when a
// finished correction gets saved via onChange rather than this component
// managing its own persistence.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Eraser,
  Hand,
  HelpCircle,
  Maximize,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  Scan,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { SectionTrace } from "@/lib/sections/volumeField";
import { paper, cleanupShapes, ensurePaperSetup, makePath, pathsOf, splitShapes, type Shape } from "@/lib/sections/correctionGeometry";

type Tool = "select" | "marquee" | "add" | "subtract" | "erase" | "pan";
type DraftMode = "add" | "subtract";
type Handle = "handleIn" | "handleOut";
interface AnchorRef {
  i: number;
  pi: number;
  si: number;
  handle?: Handle;
}
type Gesture =
  | { type: "pan"; sx: number; sy: number; tx: number; ty: number; toggle: number }
  | ({ type: "anchor"; before: string } & AnchorRef)
  | { type: "marquee"; startX: number; startY: number }
  | { type: "erase"; before: string; cutter: paper.Path | null; lastX: number | null; lastY: number | null };

const TOOL_MESSAGE: Record<Tool, string> = {
  select: "Select mass to edit its anchors",
  marquee: "Enclose whole objects to select",
  add: "Outline missing mass",
  subtract: "Outline space to remove",
  erase: "Drag to erase vector mass",
  pan: "Drag to move the view",
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 12;
const HISTORY_LIMIT = 40;

function snapshotOf(shapes: Shape[], draft: [number, number][], draftMode: DraftMode): string {
  return JSON.stringify({ shapes, draft, draftMode });
}

export function CorrectionEditor({
  tileName,
  imageSrc,
  proposal,
  correction,
  onChange,
  onClose,
}: {
  tileName: string;
  imageSrc: string;
  proposal: SectionTrace;
  correction: SectionTrace | null;
  onChange: (correction: SectionTrace) => void;
  onClose?: () => void;
}) {
  // Must happen before any Paper.js geometry call, including the useMemo
  // right below -- an effect would run too late (after this render's own
  // makePath calls), and this component only ever mounts client-side (it's
  // loaded with next/dynamic's ssr:false in SectionsTab.tsx), so calling it
  // directly during render, not from an effect, is safe here.
  ensurePaperSetup();

  const original = useMemo(() => proposal.shapes.flatMap((s) => splitShapes(makePath(s.d))), [proposal]);
  const [shapes, setShapes] = useState<Shape[]>(() => (correction ? correction.shapes : original));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeAnchor, setActiveAnchor] = useState<AnchorRef | null>(null);
  const [tool, setToolState] = useState<Tool>("select");
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [draftMode, setDraftMode] = useState<DraftMode>("add");
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [message, setMessage] = useState("Select mass to edit its anchors");

  const [showRaster, setShowRaster] = useState(true);
  const [showVector, setShowVector] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [opacity, setOpacity] = useState(65);
  const [brushSize, setBrushSize] = useState(24);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [fragmentPct, setFragmentPct] = useState(0.02);
  const [holePct, setHolePct] = useState(0.01);
  const [protectSelection, setProtectSelection] = useState(true);
  const [cleanupCompare, setCleanupCompare] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<{ shapes: Shape[]; removed: string[]; filled: string[]; source: string } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = proposal;

  const commit = useCallback(
    (before: string, nextShapes: Shape[], nextSelected?: Set<number>, nextActiveAnchor?: AnchorRef | null) => {
      setShapes(nextShapes);
      if (nextSelected) setSelected(nextSelected);
      if (nextActiveAnchor !== undefined) setActiveAnchor(nextActiveAnchor);
      const after = snapshotOf(nextShapes, draft, draftMode);
      if (before !== after) {
        setHistory((h) => [...h, before].slice(-HISTORY_LIMIT));
        setFuture([]);
      }
      onChange({ width, height, shapes: nextShapes });
    },
    [draft, draftMode, height, onChange, width],
  );

  const restore = useCallback(
    (s: string) => {
      const data = JSON.parse(s) as { shapes: Shape[]; draft: [number, number][]; draftMode: DraftMode };
      setShapes(data.shapes);
      setDraft(data.draft ?? []);
      setDraftMode(data.draftMode ?? "add");
      setSelected(new Set());
      setActiveAnchor(null);
      onChange({ width, height, shapes: data.shapes });
    },
    [height, onChange, width],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [...f, snapshotOf(shapes, draft, draftMode)]);
      restore(prev);
      return h.slice(0, -1);
    });
  }, [draft, draftMode, restore, shapes]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      setHistory((h) => [...h, snapshotOf(shapes, draft, draftMode)]);
      restore(next);
      return f.slice(0, -1);
    });
  }, [draft, draftMode, restore, shapes]);

  const setTool = useCallback((t: Tool) => {
    setGesture((g) => {
      if (g) return g; // mid-gesture tool switches are ignored, same as the original
      setToolState(t);
      setActiveAnchor(null);
      setMessage(TOOL_MESSAGE[t]);
      return g;
    });
  }, []);

  function hitShape(p: paper.Point, list: Shape[]): number {
    for (let i = list.length - 1; i >= 0; i--) if (makePath(list[i].d).contains(p)) return i;
    return -1;
  }

  function hitAnchor(p: paper.Point): AnchorRef | null {
    for (const i of selected) {
      const ps = pathsOf(makePath(shapes[i].d));
      for (let pi = 0; pi < ps.length; pi++) {
        for (let si = 0; si < ps[pi].segments.length; si++) {
          const seg = ps[pi].segments[si];
          if (activeAnchor?.i === i && activeAnchor.pi === pi && activeAnchor.si === si) {
            for (const h of ["handleIn", "handleOut"] as const) {
              if (seg[h].length && seg.point.add(seg[h]).getDistance(p) < 7 / scale) return { i, pi, si, handle: h };
            }
          }
          if (seg.point.getDistance(p) < 6 / scale) return { i, pi, si };
        }
      }
    }
    return null;
  }

  function booleanOp(shapesIn: Shape[], cutter: paper.Path | paper.CompoundPath, operation: DraftMode): Shape[] {
    if (operation === "subtract") {
      const next: Shape[] = [];
      for (const s of shapesIn) {
        const p = makePath(s.d);
        if (!p.bounds.intersects(cutter.bounds)) {
          next.push(s);
          continue;
        }
        const result = p.subtract(cutter, { insert: false }) as paper.Path | paper.CompoundPath;
        result.reorient(false, true);
        next.push(...splitShapes(result));
      }
      return next;
    }
    let merged: paper.PathItem = cutter;
    const untouched: Shape[] = [];
    for (const s of shapesIn) {
      const p = makePath(s.d);
      if (p.bounds.intersects(merged.bounds)) merged = merged.unite(p, { insert: false });
      else untouched.push(s);
    }
    merged.reorient(false, true);
    return [...untouched, ...splitShapes(merged as paper.Path | paper.CompoundPath)];
  }

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return { sx, sy, wx: (sx - tx) / scale, wy: (sy - ty) / scale };
    },
    [tx, ty, scale],
  );

  const fit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = Math.min((rect.width - 64) / width, (rect.height - 40) / height);
    setScale(next);
    setTx((rect.width - width * next) / 2);
    setTy((rect.height - height * next) / 2);
  }, [width, height]);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function zoomBy(factor: number, aroundX: number, aroundY: number) {
    setScale((old) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
      setTx((prevTx) => aroundX - ((aroundX - prevTx) * next) / old);
      setTy((prevTy) => aroundY - ((aroundY - prevTy) * next) / old);
      return next;
    });
  }

  function finishDraft() {
    if (draft.length < 3) return;
    const before = snapshotOf(shapes, draft, draftMode);
    try {
      const p = new paper.Path({ segments: draft.map(([x, y]) => new paper.Point(x, y)), closed: true, insert: false });
      const next = booleanOp(shapes, p, draftMode);
      setDraft([]);
      commit(before, next, new Set(), null);
    } catch (err) {
      restore(before);
      setMessage("Operation failed; original geometry retained");
      console.error(err);
    }
  }

  function erasePart(cutterSoFar: paper.Path | null, ax: number | null, ay: number | null, bx: number, by: number): paper.Path {
    const r = brushSize / 2;
    const b = new paper.Point(bx, by);
    let c = new paper.Path.Circle({ center: b, radius: r, insert: false });
    if (ax !== null && ay !== null) {
      const a = new paper.Point(ax, ay);
      if (a.getDistance(b) > 0) {
        const diff = b.subtract(a);
        const unit = diff.divide(diff.length || 1);
        const normal = new paper.Point(-unit.y * r, unit.x * r);
        const bridge = new paper.Path({
          segments: [a.add(normal), b.add(normal), b.subtract(normal), a.subtract(normal)],
          closed: true,
          insert: false,
        });
        c = c.unite(bridge, { insert: false }).unite(new paper.Path.Circle({ center: a, radius: r, insert: false }), { insert: false }) as paper.Path;
      }
    }
    return (cutterSoFar ? cutterSoFar.unite(c, { insert: false }) : c) as paper.Path;
  }

  function removeSelection() {
    if (!selected.size) return;
    const before = snapshotOf(shapes, draft, draftMode);
    if (activeAnchor) {
      const { i, pi, si } = activeAnchor;
      const p = makePath(shapes[i].d);
      const path = pathsOf(p)[pi];
      if (path.segments.length <= 3) {
        setMessage("Keep at least three anchors; select the object to delete it");
        return;
      }
      path.removeSegment(si);
      const next = shapes.map((s, idx) => (idx === i ? { d: p.pathData } : s));
      commit(before, next, undefined, null);
    } else {
      const next = shapes.filter((_, i) => !selected.has(i));
      commit(before, next, new Set());
    }
  }

  // --- pointer handling -----------------------------------------------

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    if (cleanupPreview && !cleanupCompare && !e.shiftKey && tool !== "pan") return;
    const { sx, sy, wx, wy } = screenToWorld(e.clientX, e.clientY);
    setCursor({ x: wx, y: wy });
    const worldPoint = new paper.Point(wx, wy);

    if (e.shiftKey || tool === "pan") {
      setGesture({ type: "pan", sx, sy, tx, ty, toggle: e.shiftKey && tool === "select" ? hitShape(worldPoint, shapes) : -1 });
    } else if (tool === "select") {
      const a = showAnchors ? hitAnchor(worldPoint) : null;
      if (a) {
        setActiveAnchor(a);
        setGesture({ type: "anchor", ...a, before: snapshotOf(shapes, draft, draftMode) });
      } else {
        const i = hitShape(worldPoint, shapes);
        setActiveAnchor(null);
        setSelected(i >= 0 ? new Set([i]) : new Set());
      }
    } else if (tool === "marquee") {
      setGesture({ type: "marquee", startX: wx, startY: wy });
      setSelected(new Set());
    } else if (tool === "erase") {
      const before = snapshotOf(shapes, draft, draftMode);
      const cutter = erasePart(null, null, null, wx, wy);
      setGesture({ type: "erase", before, cutter, lastX: wx, lastY: wy });
    } else {
      if (draft.length && draftMode !== tool) {
        setMessage("Finish or cancel the existing pen path first");
        return;
      }
      if (draft.length >= 3 && new paper.Point(...draft[0]).getDistance(worldPoint) < 8 / scale) {
        finishDraft();
        return;
      }
      const before = snapshotOf(shapes, draft, draftMode);
      const nextMode = draft.length ? draftMode : tool;
      const nextDraft: [number, number][] = [...draft, [wx, wy]];
      setDraftMode(nextMode);
      setDraft(nextDraft);
      const after = snapshotOf(shapes, nextDraft, nextMode);
      if (before !== after) {
        setHistory((h) => [...h, before].slice(-HISTORY_LIMIT));
        setFuture([]);
      }
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const { sx, sy, wx, wy } = screenToWorld(e.clientX, e.clientY);
    setCursor({ x: wx, y: wy });
    if (!gesture) return;
    if (gesture.type === "pan") {
      setTx(gesture.tx + sx - gesture.sx);
      setTy(gesture.ty + sy - gesture.sy);
    } else if (gesture.type === "anchor") {
      const p = makePath(shapes[gesture.i].d);
      const seg = pathsOf(p)[gesture.pi].segments[gesture.si];
      if (gesture.handle) seg[gesture.handle] = new paper.Point(wx, wy).subtract(seg.point);
      else seg.point = new paper.Point(wx, wy);
      setShapes((prev) => prev.map((s, idx) => (idx === gesture.i ? { d: p.pathData } : s)));
    } else if (gesture.type === "erase") {
      const cutter = erasePart(gesture.cutter, gesture.lastX, gesture.lastY, wx, wy);
      setGesture({ ...gesture, cutter, lastX: wx, lastY: wy });
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!gesture) return;
    const g = gesture;
    try {
      if (g.type === "pan" && g.toggle >= 0) {
        const { sx, sy } = screenToWorld(e.clientX, e.clientY);
        if (Math.hypot(sx - g.sx, sy - g.sy) < 4) {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(g.toggle)) next.delete(g.toggle);
            else next.add(g.toggle);
            return next;
          });
        }
      }
      if (g.type === "erase" && g.cutter) {
        const next = booleanOp(shapes, g.cutter, "subtract");
        setGesture(null);
        commit(g.before, next, new Set());
        return;
      }
      if (g.type === "marquee") {
        const { wx, wy } = screenToWorld(e.clientX, e.clientY);
        const rect = new paper.Rectangle(new paper.Point(g.startX, g.startY), new paper.Point(wx, wy));
        setSelected((prev) => {
          const next = new Set(prev);
          shapes.forEach((s, i) => {
            if (rect.contains(makePath(s.d).bounds)) next.add(i);
          });
          return next;
        });
      }
      if (g.type === "anchor") commit(g.before, shapes);
      setGesture(null);
    } catch (err) {
      setGesture(null);
      restore(g.type === "anchor" || g.type === "erase" ? g.before : snapshotOf(shapes, draft, draftMode));
      setMessage("Edit failed; geometry restored");
      console.error(err);
    }
  }

  function onPointerLeave() {
    if (!gesture) setCursor(null);
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const { sx, sy } = screenToWorld(e.clientX, e.clientY);
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.002)), sx, sy);
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (cleanupPreview && !cleanupCompare) return;
    if (tool !== "select") return;
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const p = new paper.Point(wx, wy);
    for (const i of selected) {
      const shape = makePath(shapes[i].d);
      for (const path of pathsOf(shape)) {
        const loc = path.getNearestLocation(p);
        if (loc && loc.point.getDistance(p) < 8 / scale) {
          const before = snapshotOf(shapes, draft, draftMode);
          path.divideAt(loc);
          const next = shapes.map((s, idx) => (idx === i ? { d: shape.pathData } : s));
          commit(before, next, undefined, null);
          return;
        }
      }
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.matches('textarea, input:not([type="range"]):not([type="checkbox"])')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!gesture) (e.shiftKey ? redo : undo)();
        return;
      }
      if (e.key === "Escape") {
        if (gesture) {
          setGesture(null);
          if ("before" in gesture) restore(gesture.before);
        } else if (draft.length) {
          const before = snapshotOf(shapes, draft, draftMode);
          setDraft([]);
          commit(before, shapes);
        } else {
          setSelected(new Set());
          setActiveAnchor(null);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
      }
      if (e.key === "Enter" && draft.length) finishDraft();
      const map: Record<string, Tool> = { v: "select", m: "marquee", p: "add", d: "subtract", e: "erase", h: "pan" };
      if (!e.metaKey && !e.ctrlKey && map[e.key]) setTool(map[e.key]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture, draft, shapes, draftMode, selected, activeAnchor]);

  function previewCleanup() {
    if (![fragmentPct, holePct].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return;
    const result = cleanupShapes(shapes, {
      fragmentArea: (width * height * fragmentPct) / 100,
      holeArea: (width * height * holePct) / 100,
      protectedIndices: protectSelection ? [...selected] : [],
    });
    setCleanupPreview({ ...result, source: JSON.stringify(shapes) });
  }

  function applyCleanup() {
    if (!cleanupPreview || cleanupPreview.source !== JSON.stringify(shapes)) return;
    const before = snapshotOf(shapes, draft, draftMode);
    setCleanupPreview(null);
    setCleanupOpen(false);
    commit(before, structuredClone(cleanupPreview.shapes), new Set(), null);
    setMessage("Cleanup applied - Undo restores previous geometry");
  }

  function resetToProposal() {
    const before = snapshotOf(shapes, draft, draftMode);
    setDraft([]);
    commit(before, structuredClone(original), new Set(), null);
    setResetConfirmOpen(false);
  }

  // A geometry-changing action (anything but the cleanup toggles) stales
  // whatever preview is showing -- recomputing it is an explicit "Preview"
  // click, not automatic, since the Paper.js boolean ops it runs aren't
  // instant on a dense tile.
  const cleanupStale = !!cleanupPreview && cleanupPreview.source !== JSON.stringify(shapes);
  const showCleanup = !!cleanupPreview && !cleanupCompare && !cleanupStale;
  const displayShapes = showCleanup ? cleanupPreview!.shapes : shapes;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 bg-black/40 text-xs">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
        {([
          ["select", MousePointer2, "Select / edit anchors (V)"],
          ["marquee", Scan, "Marquee: select whole objects (M)"],
          ["add", PenTool, "Pen: add mass (P)"],
          ["subtract", Minus, "Pen: subtract void (D)"],
          ["erase", Eraser, "Vector eraser (E)"],
          ["pan", Hand, "Pan (H), or hold Shift"],
        ] as const).map(([name, Icon, title]) => (
          <Button key={name} size="icon" variant={tool === name ? "default" : "ghost"} title={title} onClick={() => setTool(name)}>
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <div className="mx-1 h-5 w-px bg-white/15" />
        <Button size="icon" variant="ghost" title="Undo (Cmd+Z)" disabled={!history.length} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" title="Redo (Cmd+Shift+Z)" disabled={!future.length} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" title="Delete selection" disabled={!selected.size} onClick={removeSelection}>
          <Trash2 className="h-4 w-4" />
        </Button>
        {tool === "erase" && (
          <label className="ml-2 flex items-center gap-2 text-muted-foreground">
            Size
            <Slider className="w-24" min={2} max={100} value={[brushSize]} onValueChange={(v) => setBrushSize(Array.isArray(v) ? v[0] : v)} />
            <span className="w-6 font-mono">{brushSize}</span>
          </label>
        )}
        {draft.length > 0 && (
          <>
            <Button size="icon" variant="ghost" title="Close path and apply" disabled={draft.length < 3} onClick={finishDraft}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Cancel unfinished path"
              onClick={() => {
                const before = snapshotOf(shapes, draft, draftMode);
                setDraft([]);
                commit(before, shapes);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
        <div className="flex-1" />
        <Button size="icon" variant="ghost" title="Zoom out around image center" onClick={() => zoomBy(0.8, tx + (width * scale) / 2, ty + (height * scale) / 2)}>
          <Minus className="h-4 w-4" />
        </Button>
        <output className="w-12 text-center font-mono">{Math.round(scale * 100)}%</output>
        <Button size="icon" variant="ghost" title="Zoom in around image center" onClick={() => zoomBy(1.25, tx + (width * scale) / 2, ty + (height * scale) / 2)}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" title="Fit to screen" onClick={fit}>
          <Maximize className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-2 pb-2 text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showRaster} onChange={(e) => setShowRaster(e.target.checked)} /> Raster
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showVector} onChange={(e) => setShowVector(e.target.checked)} /> Vector
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showAnchors} onChange={(e) => setShowAnchors(e.target.checked)} /> Anchors
        </label>
        <label className="flex items-center gap-2">
          Opacity
          <Slider className="w-24" min={0} max={100} value={[opacity]} onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)} />
        </label>
        <div className="flex-1" />
        <span className="font-mono">{message}</span>
        <Button size="sm" variant="ghost" title="Preview fragment and hole cleanup" onClick={() => setCleanupOpen((v) => !v)}>
          Cleanup study
        </Button>
        <Button size="icon" variant="ghost" title="Reset draft to proposal" onClick={() => setResetConfirmOpen(true)}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" title="Tool guide" onClick={() => setHelpOpen((v) => !v)}>
          <HelpCircle className="h-4 w-4" />
        </Button>
        {onClose && (
          <Button size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className={cn("h-full w-full touch-none", tool === "pan" ? "cursor-grab" : tool === "erase" ? "cursor-crosshair" : "cursor-default")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setGesture(null)}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        >
          <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
            {showRaster && <image href={imageSrc} width={width} height={height} />}
            <g opacity={opacity / 100} style={{ display: showVector ? undefined : "none" }}>
              {displayShapes.map((s, i) => (
                <path key={i} d={s.d} fill="white" fillRule="evenodd" />
              ))}
            </g>
            {!showCleanup &&
              [...selected].map((i) =>
                shapes[i] ? <path key={i} d={shapes[i].d} fill="none" stroke="#ff269e" strokeWidth={1 / scale} /> : null,
              )}
            {!showCleanup &&
              showAnchors &&
              tool === "select" &&
              [...selected].flatMap((i) =>
                shapes[i]
                  ? pathsOf(makePath(shapes[i].d)).flatMap((p, pi) =>
                      p.segments.map((seg, si) => {
                        const { x, y } = seg.point;
                        const r = 2.5 / scale;
                        const isActive = activeAnchor?.i === i && activeAnchor.pi === pi && activeAnchor.si === si;
                        return (
                          <g key={`${i}-${pi}-${si}`}>
                            <path d={`M${x - r},${y}h${2 * r}M${x},${y - r}v${2 * r}`} stroke="#6bd6d4" strokeWidth={1 / scale} />
                            {isActive &&
                              (["handleIn", "handleOut"] as const).map((h) => {
                                if (!seg[h].length) return null;
                                const end = seg.point.add(seg[h]);
                                return (
                                  <g key={h}>
                                    <path d={`M${x},${y}L${end.x},${end.y}`} stroke="#888" strokeWidth={1 / scale} />
                                    <circle cx={end.x} cy={end.y} r={3 / scale} fill="#ff269e" />
                                  </g>
                                );
                              })}
                          </g>
                        );
                      }),
                    )
                  : [],
              )}
            {showCleanup &&
              [...cleanupPreview!.removed.map((d) => ({ d, color: "#ff269e" })), ...cleanupPreview!.filled.map((d) => ({ d, color: "#6bd6d4" }))].map(
                ({ d, color }, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={1 / scale} strokeDasharray={`${2 / scale} ${3 / scale}`} />,
              )}
            {draft.length > 0 && (
              <>
                <path
                  d={[...draft, ...(cursor && (tool === "add" || tool === "subtract") ? [[cursor.x, cursor.y] as [number, number]] : [])]
                    .map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`)
                    .join(" ")}
                  fill="none"
                  stroke={tool === "subtract" ? "#ff269e" : "#6bd6d4"}
                  strokeWidth={1 / scale}
                />
                {draft.map(([x, y], i) => (
                  <path key={i} d={`M${x - 2.5 / scale},${y}h${5 / scale}M${x},${y - 2.5 / scale}v${5 / scale}`} stroke="#6bd6d4" strokeWidth={1 / scale} />
                ))}
              </>
            )}
            {tool === "erase" && cursor && <circle cx={cursor.x} cy={cursor.y} r={brushSize / 2} fill="#ff269e22" stroke="#ff269e" strokeWidth={1 / scale} />}
            {gesture?.type === "marquee" && cursor && (
              <rect
                x={Math.min(gesture.startX, cursor.x)}
                y={Math.min(gesture.startY, cursor.y)}
                width={Math.abs(cursor.x - gesture.startX)}
                height={Math.abs(cursor.y - gesture.startY)}
                fill="#6bd6d415"
                stroke="#6bd6d4"
                strokeWidth={1 / scale}
                strokeDasharray={`${4 / scale} ${4 / scale}`}
              />
            )}
          </g>
        </svg>

        {helpOpen && (
          <aside className="absolute right-2 top-2 w-72 space-y-2 rounded-lg border border-white/15 bg-black/90 p-3 text-[11px] text-muted-foreground">
            <h3 className="font-mono uppercase tracking-label text-foreground">Correction tools</h3>
            <p>Select: click mass, then drag its anchors or curve handles. Double-click an edge to add an anchor.</p>
            <p>Marquee: drag to enclose whole objects. Shift-click toggles an individual object.</p>
            <p>Pen: click corners; click the first point or the checkmark to close and apply.</p>
            <p>Eraser: drag to subtract mass. One stroke = one undo.</p>
            <p>Hold Shift to pan. Scroll / pinch to zoom at the cursor. Fit restores the view.</p>
            <p>Cmd/Ctrl+Z / Shift+Z: undo / redo. Escape cancels. Delete removes selected objects or the active anchor.</p>
          </aside>
        )}

        {cleanupOpen && (
          <aside className="absolute left-2 top-2 w-72 space-y-2 rounded-lg border border-white/15 bg-black/90 p-3 text-[11px]">
            <div className="font-mono uppercase tracking-label text-foreground">Section-ready cleanup</div>
            <label className="flex items-center justify-between gap-2 text-muted-foreground">
              Fragment area %
              <input type="number" min={0} max={1} step="any" value={fragmentPct} onChange={(e) => { setFragmentPct(Number(e.target.value)); setCleanupPreview(null); }} className="w-20 rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-foreground" />
            </label>
            <label className="flex items-center justify-between gap-2 text-muted-foreground">
              Hole area %
              <input type="number" min={0} max={1} step="any" value={holePct} onChange={(e) => { setHolePct(Number(e.target.value)); setCleanupPreview(null); }} className="w-20 rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-foreground" />
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={protectSelection} onChange={(e) => { setProtectSelection(e.target.checked); setCleanupPreview(null); }} /> Protect selected objects
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={cleanupCompare} onChange={(e) => setCleanupCompare(e.target.checked)} /> Show original
            </label>
            {cleanupPreview && (
              <output className="block text-muted-foreground">
                {cleanupPreview.removed.length} fragments removed (magenta) · {cleanupPreview.filled.length} holes filled (cyan)
              </output>
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={previewCleanup}>Preview</Button>
              <Button size="sm" variant="outline" disabled={!cleanupPreview} onClick={applyCleanup}>Apply &amp; Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setCleanupOpen(false); setCleanupPreview(null); }}>Close</Button>
            </div>
          </aside>
        )}

        {resetConfirmOpen && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="w-80 space-y-3 rounded-lg border border-white/15 bg-black p-4">
              <h3 className="text-sm font-medium">Reset {tileName}&rsquo;s draft to proposal?</h3>
              <p className="text-muted-foreground">Your current edits can be recovered with Undo.</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
                <Button size="sm" variant="outline" onClick={resetToProposal}>Reset draft</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/10 px-2 py-1 text-muted-foreground">
        <span>{tileName}</span>
        <span>
          {showCleanup ? `${cleanupPreview!.shapes.length} objects · cleanup preview` : `${shapes.length} objects · ${selected.size} selected`}
        </span>
      </div>
    </div>
  );
}

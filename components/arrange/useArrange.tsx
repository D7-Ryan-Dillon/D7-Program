"use client";

// The Arrange tab's brain: the arrangement document with undo, everything derived from it (the layout, joints, warnings,
// the whole-building analysis), and every action the panels and the keyboard call. The connected rule is enforced here:
// every edit goes through `tryCommit`, which refuses overlaps and asks what to do about pieces an edit would cut off.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { toast } from "sonner";
import type { ParsedTile } from "@/lib/types";
import { useProject, useProjectUi } from "@/lib/project-store";
import { useShortcuts, type ShortcutDef } from "@/lib/shortcuts";
import type { MeshColors, MeshVisibility } from "@/components/viewer/ThreeViewport";
import type { ViewportHandle } from "@/lib/viewportCapture";
import { capturePosePng } from "@/lib/arrange/capture";
import { useHistory } from "@/lib/arrange/history";
import { useWalkRules } from "@/lib/useWalkRules";
import { analyzeLayout, entrancePoint as layoutEntrancePoint, type Layout } from "@/lib/arrange/layout";
import { evaluateProgram } from "@/lib/arrange/program";
import { snapPosition } from "@/lib/arrange/snap";
import { alignPieces, checkEdit, duplicatePiece, groupPieces, makePiece, mirrorGroup, movePieces, patchPieces, reattachIslands, removePieces, rotateGroup, ungroupPieces, withGroups, type AlignMode } from "@/lib/arrange/ops";
import { generateArrangement, regenerateMarked, type GenContext, type GenResult } from "@/lib/arrange/generate";
import { applySuggestion, betterTiles, suggestFor, suggestNext, type Replacement, type Suggestion } from "@/lib/arrange/suggest";
import { buildComposite, compositeMeshes, compositeToTile, readComposite, type Composite, type CompositeMeshes } from "@/lib/arrange/composite";
import { smoothComposite, type SmoothReport } from "@/lib/arrange/smooth";
import { autoNames, buildSequence, evidenceFor, namesFor, summarizeWhole, type EvidenceItem, type Sequence, type WholeSummary } from "@/lib/arrange/whole";
import { isPlaceable, orientedDims } from "@/lib/arrange/orient";
import { toCell, toFt } from "@/lib/arrange/geometry";
import {
  defaultGen,
  defaultPriorities,
  defaultRules,
  defaultSite,
  defaultSmooth,
  emptyDoc,
  type ArrangeWarning,
  type ArrangementDoc,
  type GenSettings,
  type Joint,
  type Piece,
  type Priorities,
  type ProgramRules,
  type ConnectorChoice, type Rating,
  type SavedArrangement,
  type Site,
  type SmoothSettings,
  type Vec3,
} from "@/lib/arrange/types";
import type { ViewportApi, ViewportMode } from "@/components/arrange/ArrangeViewport";

/** What the Arrange tab remembers per project. */
export interface ArrangeUi {
  /** the tiles checked in the bank */
  selected: string[];
  gen: GenSettings;
  priorities: Priorities;
  rules: ProgramRules;
  site: Site;
  smooth: SmoothSettings;
  visibility: MeshVisibility;
  colors: MeshColors;
  foamOpacity: number;
  autoRotate: boolean;
  rotateSecs: number;
  /** Which default look was saved (2 = solid white foam alone); an older one is brought to it once. */
  look?: number;
  lattice: boolean;
  snapRadiusFt: number;
  showJoints: boolean;
  advanced: boolean;
  smoothOn: boolean;
  /** the arrangement being worked on, saved as you go */
  current: ArrangementDoc;
  currentId: string | null;
  currentName: string;
  saved: SavedArrangement[];
}

export const defaultArrangeUi = (): ArrangeUi => ({
  selected: [],
  gen: defaultGen(),
  priorities: defaultPriorities(),
  rules: defaultRules(),
  site: defaultSite(),
  smooth: defaultSmooth(),
  // solid white foam alone; void, plates and branches are one switch away in Display
  visibility: { foam: true, void: false, plates: false, struts: false },
  colors: { foam: "#ffffff", void: "#c43383", plates: "#f2b878", struts: "#db7228" },
  foamOpacity: 1,
  autoRotate: false,
  rotateSecs: 24,
  look: 2,
  lattice: false,
  snapRadiusFt: 8,
  showJoints: true,
  advanced: false,
  smoothOn: false,
  current: emptyDoc(),
  currentId: null,
  currentName: "Arrangement 1",
  saved: [],
});

export interface WholeState {
  status: "idle" | "working" | "ready" | "skipped";
  tile: ParsedTile | null;
  summary: WholeSummary | null;
  evidence: EvidenceItem[];
  smooth: SmoothReport | null;
  comp: Composite | null;
  cells: number;
}

export interface PendingEdit {
  doc: ArrangementDoc;
  islands: string[][];
  what: string;
}

export type CompareMode = "off" | "side" | "wipe";

export interface ArrangeController {
  tiles: ParsedTile[];
  tileById: Map<string, ParsedTile>;
  bank: ParsedTile[];
  ui: ArrangeUi;
  setUi: (next: ArrangeUi | ((p: ArrangeUi) => ArrangeUi)) => void;
  patchUi: (patch: Partial<ArrangeUi>) => void;
  // document
  doc: ArrangementDoc;
  /** what the viewport shows (a drag in progress or an interlock preview replaces the document) */
  shown: ArrangementDoc;
  layout: Layout;
  joints: Joint[];
  warnings: ArrangeWarning[];
  sequence: Sequence;
  autoName: Record<string, string>;
  nameOf: (id: string) => string;
  entrance: Vec3 | null;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  commit(next: ArrangementDoc): void;
  tryCommit(next: ArrangementDoc, what: string): boolean;
  // selection
  sel: Set<string>;
  setSel(s: Set<string>): void;
  selJoint: string | null;
  setSelJoint(id: string | null): void;
  pick(id: string | null, additive: boolean): void;
  highlight: Set<string>;
  setHighlight(s: Set<string>): void;
  /** the piece a point (ft) belongs to, or null */
  pieceAt(p: Vec3): string | null;
  selectionBoxes: { min: Vec3; max: Vec3 }[];
  // viewport
  mode: ViewportMode;
  setMode(m: ViewportMode): void;
  measure: Vec3[];
  addMeasurePoint(p: Vec3): void;
  levelCut: number | null;
  setLevelCut(z: number | null): void;
  fitKey: number;
  refit(): void;
  viewportApi: MutableRefObject<ViewportApi | null>;
  viewportHandle: MutableRefObject<ViewportHandle | null>;
  focusOn(center: Vec3, radius: number): void;
  // drag
  onDragStart(id: string): boolean;
  onDrag(delta: Vec3, vertical: boolean): void;
  onDragEnd(): void;
  snapNote: string | null;
  /** a drag is in progress (the separate pieces are shown, not the smoothed whole) */
  dragging: boolean;
  // pieces
  addTile(tileId: string): void;
  removeSelected(): void;
  replaceSelected(tileId: string): void;
  rotateSelected(turns?: number): void;
  mirrorSelected(): void;
  lockSelected(): void;
  duplicateSelected(): void;
  moveSelected(delta: Vec3): void;
  setPiecePos(id: string, pos: Vec3): void;
  setPieceScale(id: string, scale: number): void;
  align(mode: AlignMode): void;
  groupSelected(): void;
  ungroupSelected(): void;
  selectCategory(cat: string): void;
  selectConnected(): void;
  invertSelection(): void;
  setEntrance(id: string | null): void;
  rename(id: string, name: string): void;
  autoNameAll(): void;
  rateJoint(id: string, r: Rating | null): void;
  /** Build (or take out) a stair or ramp at a joint whose floors are a doorway apart; null puts the joint back to what the rule says. */
  setConnector(jointId: string, choice: ConnectorChoice | null): void;
  // generating
  busy: string | null;
  /** what the viewport is waiting for, or null: a generation (until the whole result is built and read) or a tile being built */
  loading: string | null;
  notes: string[];
  why: string;
  generate(): void;
  growMore(): void;
  regenerate(): void;
  genContext(bankOverride?: ParsedTile[]): GenContext;
  // helpers
  suggestions: { kind: "next" | "gap" | "replace"; items: Suggestion[]; replacements?: Replacement[]; label: string } | null;
  suggestFor(pieceId: string | null): void;
  fillGap(exposedIndex: number): void;
  suggestReplace(pieceId: string): void;
  applySuggestionAt(i: number): void;
  previewSuggestion: number | null;
  setPreviewSuggestion(i: number | null): void;
  clearSuggestions(): void;
  ghosts: { piece: Piece; tile: ParsedTile }[];
  // whole / smoothing
  whole: WholeState;
  runWhole(force?: boolean): void;
  meshes: CompositeMeshes | null;
  evidenceKey: string | null;
  setEvidenceKey(k: string | null): void;
  evidence: EvidenceItem | null;
  // saved arrangements & tiles
  newArrangement(): void;
  openArrangement(id: string): void;
  deleteArrangement(id: string): void;
  duplicateArrangement(id: string): void;
  renameArrangement(id: string, name: string): void;
  addAsTile(): Promise<void>;
  valid: boolean;
  // orphan dialog
  pending: PendingEdit | null;
  resolvePending(choice: "remove" | "reattach" | "cancel"): void;
  // interlock preview
  interlock: { doc: ArrangementDoc; label: string } | null;
  setInterlock(v: { doc: ArrangementDoc; label: string } | null): void;
  // compare
  compare: CompareMode;
  setCompare(m: CompareMode): void;
  baseline: ArrangementDoc | null;
  setBaseline(): void;
  clearBaseline(): void;
  diff: { added: Set<string>; removed: Set<string>; moved: Set<string> };
  viewportHidden: Set<string> | null;
  setViewportHidden(s: Set<string> | null): void;
  thumb(): Promise<string | undefined>;
}

const Ctx = createContext<ArrangeController | null>(null);
export const useArrange = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useArrange must be used inside <ArrangeProvider>");
  return c;
};

// the reading runs in a worker, so even big arrangements are read live; beyond this it waits for a click
const LIVE_CELLS = 6_000_000;

export function ArrangeProvider({ children }: { children: ReactNode }) {
  const { tiles, addTile: addProjectTile, setActiveTile } = useProject();
  const [ui, setUi] = useProjectUi<ArrangeUi>("arrange", defaultArrangeUi);
  const patchUi = useCallback((patch: Partial<ArrangeUi>) => setUi((p) => ({ ...p, ...patch })), [setUi]);
  // a project saved with the old default look (ghosted foam, magenta void) takes the new one once
  useEffect(() => {
    if ((ui.look ?? 0) >= 2) return;
    const d = defaultArrangeUi();
    setUi((p) => ({ ...p, visibility: d.visibility, colors: d.colors, foamOpacity: d.foamOpacity, autoRotate: false, look: 2 }));
  }, [ui.look, setUi]);
  const hist = useHistory<ArrangementDoc>(ui.current);
  const doc = hist.doc;

  const tileById = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const bank = useMemo(() => tiles.filter((t) => ui.selected.includes(t.id) && isPlaceable(t)), [tiles, ui.selected]);

  const [selRaw, setSelState] = useState<Set<string>>(new Set());
  const [selJoint, setSelJoint] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [mode, setModeState] = useState<ViewportMode>("orbit");
  const [measure, setMeasure] = useState<Vec3[]>([]);
  const [levelCut, setLevelCut] = useState<number | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // after a generation the result is not shown until the whole building has been read: no half-drawn or stale model in between
  const [settling, setSettling] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [drag, setDrag] = useState<{ ids: Set<string>; base: ArrangementDoc; leadId: string; leadStart: Vec3 } | null>(null);
  const [dragDoc, setDragDoc] = useState<ArrangementDoc | null>(null);
  const [snapNote, setSnapNote] = useState<string | null>(null);
  const [interlock, setInterlock] = useState<{ doc: ArrangementDoc; label: string } | null>(null);
  const [compare, setCompare] = useState<CompareMode>("off");
  const [baseline, setBaselineDoc] = useState<ArrangementDoc | null>(null);
  const [hidden, setViewportHidden] = useState<Set<string> | null>(null);
  const [suggestions, setSuggestions] = useState<ArrangeController["suggestions"]>(null);
  const [previewSuggestion, setPreviewSuggestion] = useState<number | null>(null);
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  const viewportApi = useRef<ViewportApi | null>(null);
  const viewportHandle = useRef<ViewportHandle | null>(null);

  const rules = ui.rules;
  const shown = interlock?.doc ?? dragDoc ?? doc;
  // the project's walking rules are applied before anything below reads them; a change to one recomputes the layout (and everything built on it)
  const walk = useWalkRules();
  const layout = useMemo(() => analyzeLayout(shown, tileById, rules), [shown, tileById, rules, walk.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const joints = layout.joints;
  const sequence = useMemo(() => buildSequence(layout, rules), [layout, rules]);
  const autoName = useMemo(() => autoNames(layout, sequence, tileById), [layout, sequence, tileById]);
  const nameOf = useCallback((id: string) => shown.names[id] || autoName[id] || tileById.get(shown.pieces.find((p) => p.id === id)?.tileId ?? "")?.name || id, [shown, autoName, tileById]);
  const entrance = useMemo(() => layoutEntrancePoint(layout), [layout]);

  const warnings = useMemo(() => {
    const w = evaluateProgram(layout, shown, rules, ui.site, tileById);
    const missing = shown.pieces.filter((p) => !tileById.has(p.tileId));
    if (missing.length) w.unshift({ id: "missing", kind: "tile", severity: "error", message: `${missing.length} piece${missing.length > 1 ? "s use" : " uses"} a tile that is not loaded in this project.`, pieceIds: missing.map((p) => p.id) });
    return w;
  }, [layout, shown, rules, ui.site, tileById]);
  const valid = layout.overlaps.length === 0 && layout.islands.length === 0 && shown.pieces.length > 0 && !shown.pieces.some((p) => !tileById.has(p.tileId));

  // keep the document saved with the project, and the selection to pieces that exist
  useEffect(() => {
    setUi((prev) => {
      const same = (a: ArrangementDoc, b: ArrangementDoc) => a === b || JSON.stringify(a) === JSON.stringify(b);
      const saved = prev.currentId ? prev.saved.find((s) => s.id === prev.currentId) : undefined;
      if (!doc.pieces.length) return same(prev.current, doc) ? prev : { ...prev, current: doc };
      if (same(prev.current, doc) && saved && same(saved.doc, doc)) return prev;
      // every arrangement with pieces is kept in the saved list under its own id, updated as you work
      const id = prev.currentId ?? `a${Date.now().toString(36)}`;
      const entry: SavedArrangement = { ...(saved ?? { id, name: prev.currentName, createdAt: Date.now(), gen: prev.gen, priorities: prev.priorities, rules: prev.rules, site: prev.site, smooth: prev.smooth }), doc, updatedAt: Date.now() };
      return { ...prev, current: doc, currentId: id, saved: saved ? prev.saved.map((s) => (s.id === id ? entry : s)) : [...prev.saved, entry] };
    });
  }, [doc, setUi]);
  // the selection is only ever pieces that exist
  const sel = useMemo(() => {
    const ids = new Set(doc.pieces.map((p) => p.id));
    const kept = [...selRaw].filter((id) => ids.has(id));
    return kept.length === selRaw.size ? selRaw : new Set(kept);
  }, [selRaw, doc]);

  const genContext = useCallback(
    (bankOverride?: ParsedTile[]): GenContext => ({ tileById, bank: bankOverride ?? bank, rules, priorities: ui.priorities, site: ui.site, settings: ui.gen }),
    [tileById, bank, rules, ui.priorities, ui.site, ui.gen],
  );

  const refit = useCallback(() => setFitKey((k) => k + 1), []);
  const pieceAt = useCallback(
    (p: Vec3): string | null => {
      let best: string | null = null;
      let bestD = 0.8;
      for (const b of layout.boxes) {
        const d = Math.max(toFt(b.min[0]) - p[0], p[0] - toFt(b.max[0]), toFt(b.min[1]) - p[1], p[1] - toFt(b.max[1]), toFt(b.min[2]) - p[2], p[2] - toFt(b.max[2]), 0);
        if (d < bestD) {
          bestD = d;
          best = b.piece.id;
        }
      }
      return best;
    },
    [layout],
  );
  const selectionBoxes = useMemo(() => layout.boxes.filter((b) => sel.has(b.piece.id)).map((b) => ({ min: [toFt(b.min[0]), toFt(b.min[1]), toFt(b.min[2])] as Vec3, max: [toFt(b.max[0]), toFt(b.max[1]), toFt(b.max[2])] as Vec3 })), [layout, sel]);
  const setSel = useCallback((s: Set<string>) => setSelState(s), []);
  const setMode = useCallback((m: ViewportMode) => {
    setModeState(m);
    if (m !== "measure") setMeasure([]);
  }, []);
  const addMeasurePoint = useCallback((p: Vec3) => setMeasure((m) => (m.length >= 2 ? [p] : [...m, p])), []);
  const focusOn = useCallback((c: Vec3, r: number) => viewportApi.current?.focus(c, r), []);

  // ---- committing edits ----
  const setBaseline = useCallback(() => setBaselineDoc(doc), [doc]);
  const clearBaseline = useCallback(() => setBaselineDoc(null), []);

  const tryCommit = useCallback(
    (next: ArrangementDoc, what: string): boolean => {
      const chk = checkEdit(next, tileById, rules);
      if (chk.overlaps.length) {
        toast.error(`${what}: the pieces would overlap.`);
        return false;
      }
      if (chk.islands.length) {
        setPending({ doc: next, islands: chk.islands, what });
        return false;
      }
      hist.commit(next);
      return true;
    },
    [tileById, rules, hist],
  );

  const resolvePending = useCallback(
    (choice: "remove" | "reattach" | "cancel") => {
      const p = pending;
      setPending(null);
      if (!p || choice === "cancel") return;
      if (choice === "remove") {
        hist.commit(removePieces(p.doc, new Set(p.islands.flat())));
        return;
      }
      const re = reattachIslands(p.doc, p.islands, tileById, rules);
      if (re) hist.commit(re);
      else toast.error("Couldn't find a place to re-attach them without overlapping; remove them or cancel.");
    },
    [pending, hist, tileById, rules],
  );

  // ---- selection ----
  const pick = useCallback(
    (id: string | null, additive: boolean) => {
      setSelJoint(null);
      setHighlight(new Set());
      if (!id) {
        if (!additive) setSelState(new Set());
        return;
      }
      setSelState((prev) => {
        const group = withGroups(doc, [id]);
        if (!additive) return prev.has(id) && prev.size > 1 ? prev : group;
        const next = new Set(prev);
        const all = [...group].every((g) => next.has(g));
        for (const g of group) {
          if (all) next.delete(g);
          else next.add(g);
        }
        return next;
      });
    },
    [doc],
  );

  // ---- dragging ----
  const onDragStart = useCallback(
    (id: string): boolean => {
      const piece = doc.pieces.find((p) => p.id === id);
      if (!piece) return false;
      const ids = withGroups(doc, sel.has(id) ? sel : [id]);
      if ([...ids].some((i) => doc.pieces.find((p) => p.id === i)?.locked)) {
        toast.message("Locked pieces don't move. Unlock them first (L).");
        return false;
      }
      setDrag({ ids, base: doc, leadId: id, leadStart: [...piece.pos] as Vec3 });
      return true;
    },
    [doc, sel],
  );

  const onDrag = useCallback(
    (delta: Vec3, vertical: boolean) => {
      if (!drag) return;
      const lead = drag.base.pieces.find((p) => p.id === drag.leadId);
      const tile = lead && tileById.get(lead.tileId);
      if (!lead || !tile) return;
      const want: Vec3 = vertical ? [drag.leadStart[0], drag.leadStart[1], drag.leadStart[2] + delta[2]] : [drag.leadStart[0] + delta[0], drag.leadStart[1] + delta[1], drag.leadStart[2]];
      const others = analyzeLayout({ ...drag.base, pieces: drag.base.pieces.filter((p) => !drag.ids.has(p.id)) }, tileById, rules).boxes;
      const res = snapPosition(lead, tile, others, want, { lattice: ui.lattice, radiusFt: ui.snapRadiusFt, site: ui.site });
      setSnapNote(res.rule === "grid" ? null : res.rule);
      const d: Vec3 = [res.pos[0] - drag.leadStart[0], res.pos[1] - drag.leadStart[1], res.pos[2] - drag.leadStart[2]];
      setDragDoc(movePieces(drag.base, drag.ids, d));
    },
    [drag, tileById, rules, ui.lattice, ui.snapRadiusFt, ui.site],
  );

  const onDragEnd = useCallback(() => {
    const next = dragDoc;
    setDrag(null);
    setDragDoc(null);
    setSnapNote(null);
    if (next) tryCommit(next, "Move");
  }, [dragDoc, tryCommit]);

  // ---- piece actions ----
  const selIds = useCallback(() => withGroups(doc, sel), [doc, sel]);
  const editSelected = useCallback(
    (f: (ids: Set<string>) => ArrangementDoc, what: string) => {
      const ids = selIds();
      if (!ids.size) return;
      tryCommit(f(ids), what);
    },
    [selIds, tryCommit],
  );

  const addTile = useCallback(
    (tileId: string) => {
      const tile = tileById.get(tileId);
      if (!tile || !isPlaceable(tile)) {
        toast.error("That tile can't be placed (it needs voxels at the standard cell size).");
        return;
      }
      if (!doc.pieces.length) {
        const p = makePiece(doc, tileId, [0, 0, 0]);
        hist.commit({ ...doc, pieces: [p] });
        setSelState(new Set([p.id]));
        refit();
        return;
      }
      const ctx = genContext([tile]);
      const slots = layout.exposed.filter((e) => (sel.size ? sel.has(e.pieceId) : true)).sort((a, b) => b.patch.cells - a.patch.cells).slice(0, 8);
      const found = suggestFor(ctx, doc, slots.length ? slots : layout.exposed.slice(0, 8), 1)[0] ?? suggestFor(ctx, doc, layout.exposed.slice(0, 12), 1)[0];
      if (found) {
        const r = applySuggestion(doc, found);
        if (tryCommit(r.doc, "Add")) setSelState(new Set([r.id]));
        return;
      }
      // nothing makes a walkable joint: put it flush beside something so it is at least attached
      const anchor = doc.pieces.find((p) => sel.has(p.id)) ?? doc.pieces[0];
      const dup = duplicatePiece(doc, anchor.id, tileById);
      if (dup) {
        const placed = patchPieces(dup.doc, new Set([dup.id]), { tileId, rotZ: 0, mirrorX: false });
        if (tryCommit(placed, "Add")) {
          setSelState(new Set([dup.id]));
          toast.message("No walkable joint was possible there; it is attached but has no way through. See the warnings.");
        }
      } else toast.error("There is no free place beside the selected piece.");
    },
    [tileById, doc, hist, refit, genContext, layout, sel, tryCommit],
  );

  const removeSelected = useCallback(() => editSelected((ids) => removePieces(doc, ids), "Remove"), [editSelected, doc]);
  const rotateSelected = useCallback((turns = 1) => editSelected((ids) => rotateGroup(doc, ids, tileById, turns), "Turn"), [editSelected, doc, tileById]);
  const mirrorSelected = useCallback(() => editSelected((ids) => mirrorGroup(doc, ids, tileById), "Mirror"), [editSelected, doc, tileById]);
  const lockSelected = useCallback(() => {
    const ids = selIds();
    if (!ids.size) return;
    const everyLocked = doc.pieces.filter((p) => ids.has(p.id)).every((p) => p.locked);
    hist.commit(patchPieces(doc, ids, { locked: !everyLocked }));
  }, [selIds, doc, hist]);
  const duplicateSelected = useCallback(() => {
    const id = [...sel][0];
    if (!id) return;
    const r = duplicatePiece(doc, id, tileById);
    if (!r) {
      toast.error("No free place beside it for a copy.");
      return;
    }
    if (tryCommit(r.doc, "Duplicate")) setSelState(new Set([r.id]));
  }, [sel, doc, tileById, tryCommit]);
  const moveSelected = useCallback(
    (delta: Vec3) => {
      const ids = selIds();
      if ([...ids].some((i) => doc.pieces.find((p) => p.id === i)?.locked)) {
        toast.message("Locked pieces don't move.");
        return;
      }
      editSelected((i) => movePieces(doc, i, delta), "Move");
    },
    [selIds, doc, editSelected],
  );
  const setPiecePos = useCallback((id: string, pos: Vec3) => tryCommit(patchPieces(doc, new Set([id]), { pos: [toFt(toCell(pos[0])), toFt(toCell(pos[1])), toFt(toCell(pos[2]))] }), "Move"), [doc, tryCommit]);
  const setPieceScale = useCallback((id: string, scale: number) => tryCommit(patchPieces(doc, new Set([id]), { scale: Math.min(2, Math.max(0.5, scale)) }), "Scale"), [doc, tryCommit]);
  const align = useCallback((m: AlignMode) => editSelected((ids) => alignPieces(doc, ids, tileById, m), "Align"), [editSelected, doc, tileById]);
  const groupSelected = useCallback(() => editSelected((ids) => groupPieces(doc, ids), "Group"), [editSelected, doc]);
  const ungroupSelected = useCallback(() => editSelected((ids) => ungroupPieces(doc, ids), "Ungroup"), [editSelected, doc]);
  const selectCategory = useCallback((cat: string) => setSelState(new Set(doc.pieces.filter((p) => (tileById.get(p.tileId)?.meta?.category ?? tileById.get(p.tileId)?.guessed.category ?? "other") === cat).map((p) => p.id))), [doc, tileById]);
  const selectConnected = useCallback(() => {
    const seen = new Set(sel);
    const stack = [...sel];
    const adj = new Map<string, string[]>();
    for (const c of layout.contacts) {
      adj.set(c.a.piece.id, [...(adj.get(c.a.piece.id) ?? []), c.b.piece.id]);
      adj.set(c.b.piece.id, [...(adj.get(c.b.piece.id) ?? []), c.a.piece.id]);
    }
    while (stack.length) {
      const id = stack.pop()!;
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    setSelState(seen);
  }, [sel, layout]);
  const invertSelection = useCallback(() => setSelState(new Set(doc.pieces.filter((p) => !sel.has(p.id)).map((p) => p.id))), [doc, sel]);
  const replaceSelected = useCallback(
    (tileId: string) => {
      const id = [...sel][0];
      const tile = tileById.get(tileId);
      const piece = doc.pieces.find((p) => p.id === id);
      const oldTile = piece && tileById.get(piece.tileId);
      if (!piece || !tile || !oldTile) return;
      const od = orientedDims(oldTile, piece.rotZ, piece.scale);
      const nd = orientedDims(tile, piece.rotZ, piece.scale);
      const centred: Vec3 = [toFt(toCell(piece.pos[0]) + Math.round((od[0] - nd[0]) / 2)), toFt(toCell(piece.pos[1]) + Math.round((od[1] - nd[1]) / 2)), piece.pos[2]];
      for (const pos of [piece.pos, centred]) {
        const next = patchPieces(doc, new Set([id]), { tileId, pos });
        if (checkEdit(next, tileById, rules).ok) {
          setBaselineDoc(doc);
          hist.commit(next);
          return;
        }
      }
      tryCommit(patchPieces(doc, new Set([id]), { tileId }), "Replace");
    },
    [sel, tileById, doc, rules, hist, tryCommit],
  );
  const setEntrance = useCallback((id: string | null) => hist.commit({ ...doc, entranceId: id }), [doc, hist]);
  const rename = useCallback((id: string, name: string) => hist.commit({ ...doc, names: { ...doc.names, [id]: name } }), [doc, hist]);
  const autoNameAll = useCallback(() => hist.commit({ ...doc, names: { ...autoName } }), [doc, autoName, hist]);
  const rateJoint = useCallback(
    (id: string, r: Rating | null) => {
      const ratings = { ...doc.ratings };
      if (r) ratings[id] = r;
      else delete ratings[id];
      hist.commit({ ...doc, ratings });
    },
    [doc, hist],
  );

  const setConnector = useCallback(
    (id: string, choice: ConnectorChoice | null) => {
      const connectors = { ...(doc.connectors ?? {}) };
      if (choice) connectors[id] = choice;
      else delete connectors[id];
      hist.commit({ ...doc, connectors });
    },
    [doc, hist],
  );

  // ---- generating ----
  const saveBeforeNew = useCallback(() => {
    // the arrangement being left stays in the saved list; the next one gets its own entry
    setUi((prev) => {
      if (!prev.current.pieces.length) return prev;
      const id = prev.currentId ?? `a${Date.now().toString(36)}`;
      const entry: SavedArrangement = { id, name: prev.currentName, createdAt: prev.saved.find((s) => s.id === id)?.createdAt ?? Date.now(), updatedAt: Date.now(), doc: prev.current, gen: prev.gen, priorities: prev.priorities, rules: prev.rules, site: prev.site, smooth: prev.smooth, thumb: prev.saved.find((s) => s.id === id)?.thumb, tileId: prev.saved.find((s) => s.id === id)?.tileId };
      return { ...prev, saved: prev.saved.some((s) => s.id === id) ? prev.saved.map((s) => (s.id === id ? entry : s)) : [...prev.saved, entry] };
    });
  }, [setUi]);

  const finish = useCallback(
    (r: GenResult, fresh: boolean) => {
      setNotes(r.notes);
      setWhy(r.why);
      setSettling(true);
      if (fresh) {
        saveBeforeNew();
        setBaselineDoc(doc.pieces.length ? doc : null);
        const n = ui.saved.length + 2;
        patchUi({ currentId: `a${Date.now().toString(36)}`, currentName: `Arrangement ${n}` });
        hist.reset(r.doc);
        setUi((prev) => ({ ...prev, current: r.doc }));
      } else {
        setBaselineDoc(doc);
        hist.commit(r.doc);
      }
      setSelState(new Set());
      setLevelCut(null);
      refit();
    },
    [saveBeforeNew, doc, ui.saved.length, patchUi, hist, setUi, refit],
  );

  const runGen = useCallback(
    (what: string, f: () => GenResult | null, fresh: boolean) => {
      if (!bank.length) {
        toast.error("Check at least one tile in the Bank first.");
        return;
      }
      setBusy(what);
      setTimeout(() => {
        try {
          const r = f();
          if (r) finish(r, fresh);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't generate.");
        } finally {
          setBusy(null);
        }
      }, 30);
    },
    [bank.length, finish],
  );

  const generate = useCallback(() => {
    // unless a seed is being kept, every press picks a new one (and turns the building a new way)
    let seed = ui.gen.seed;
    let direction = ui.gen.direction;
    if (!ui.gen.seedLocked) {
      seed = Math.floor(Math.random() * 9_999_999);
      direction = seed % 4;
      patchUi({ gen: { ...ui.gen, seed, direction } });
    }
    runGen(
      "Generating",
      () => {
        const c = genContext();
        return generateArrangement({ ...c, settings: { ...c.settings, seed, direction } }, { ...emptyDoc(), entranceId: null });
      },
      true,
    );
  }, [runGen, genContext, ui.gen, patchUi]);
  const growMore = useCallback(
    () =>
      runGen(
        "Growing",
        () => {
          const keep = doc.pieces.length ? doc : emptyDoc();
          return generateArrangement(genContext(), keep, { target: keep.pieces.length + ui.gen.amount });
        },
        false,
      ),
    [runGen, genContext, doc, ui.gen.amount],
  );
  const regenerate = useCallback(() => {
    const bad = new Set(Object.entries(doc.ratings).filter(([, r]) => r === "bad").map(([k]) => k));
    if (!bad.size) {
      toast.message("Mark some joints bad (thumbs down) first.");
      return;
    }
    runGen("Regenerating", () => regenerateMarked(genContext(), doc, bad, doc.pieces.length), false);
  }, [runGen, doc, genContext]);

  // ---- helpers: suggestions ----
  const clearSuggestions = useCallback(() => {
    setSuggestions(null);
    setPreviewSuggestion(null);
  }, []);
  const suggestForPiece = useCallback(
    (pieceId: string | null) => {
      if (!bank.length || !doc.pieces.length) {
        toast.message("Check tiles in the Bank and place a first piece.");
        return;
      }
      setBusy("Looking");
      setTimeout(() => {
        const items = suggestNext(genContext(), doc, pieceId, 6);
        setSuggestions({ kind: "next", items, label: pieceId ? `Next to ${nameOf(pieceId)}` : "Best next pieces" });
        setPreviewSuggestion(items.length ? 0 : null);
        setBusy(null);
        if (!items.length) toast.message("Nothing fits there within the rules.");
      }, 20);
    },
    [bank.length, doc, genContext, nameOf],
  );
  const fillGap = useCallback(
    (i: number) => {
      const slot = layout.exposed[i];
      if (!slot) return;
      setBusy("Looking");
      setTimeout(() => {
        const items = suggestFor(genContext(), doc, [slot], 6);
        setSuggestions({ kind: "gap", items, label: `Continue the opening on ${nameOf(slot.pieceId)}` });
        setPreviewSuggestion(items.length ? 0 : null);
        setBusy(null);
        if (!items.length) toast.message("No tile continues that opening within the rules.");
      }, 20);
    },
    [layout, genContext, doc, nameOf],
  );
  const suggestReplace = useCallback(
    (pieceId: string) => {
      setBusy("Comparing");
      setTimeout(() => {
        const r = betterTiles(genContext(), doc, pieceId, 6);
        setSuggestions({ kind: "replace", items: [], replacements: r.options, label: `Better tiles for ${nameOf(pieceId)}` });
        setPreviewSuggestion(null);
        setBusy(null);
        if (!r.options.length) toast.message("No other tile fits in its place.");
      }, 20);
    },
    [genContext, doc, nameOf],
  );
  const applySuggestionAt = useCallback(
    (i: number) => {
      const s = suggestions;
      if (!s) return;
      setBaselineDoc(doc);
      if (s.kind === "replace") {
        const r = s.replacements?.[i];
        if (r && tryCommit(r.doc, "Replace")) setSuggestions(null);
        return;
      }
      const it = s.items[i];
      if (!it) return;
      const r = applySuggestion(doc, it);
      if (tryCommit(r.doc, "Add")) {
        setSelState(new Set([r.id]));
        setSuggestions(null);
        setPreviewSuggestion(null);
      }
    },
    [suggestions, doc, tryCommit],
  );
  const ghosts = useMemo(() => {
    if (!suggestions || previewSuggestion === null) return [];
    if (suggestions.kind === "replace") {
      const r = suggestions.replacements?.[previewSuggestion];
      return r ? [{ piece: r.piece, tile: r.tile }] : [];
    }
    const it = suggestions.items[previewSuggestion];
    return it ? [{ piece: it.candidate.piece, tile: it.tile }] : [];
  }, [suggestions, previewSuggestion]);

  // ---- the whole building: composite, analysis, smoothing, meshes ----
  const [whole, setWhole] = useState<WholeState>({ status: "idle", tile: null, summary: null, evidence: [], smooth: null, comp: null, cells: 0 });
  const [meshes, setMeshes] = useState<CompositeMeshes | null>(null);
  const wholeRun = useRef(0);
  const forceFull = useRef(false);
  const smoothSig = JSON.stringify(ui.smooth);

  const runWhole = useCallback(
    (force = false) => {
      forceFull.current = force;
      const run = ++wholeRun.current;
      if (!layout.boxes.length) {
        setWhole({ status: "idle", tile: null, summary: null, evidence: [], smooth: null, comp: null, cells: 0 });
        setSettling(false);
        return;
      }
      setWhole((w) => ({ ...w, status: "working" }));
      setTimeout(async () => {
        try {
          let comp = buildComposite(layout.boxes);
          if (!comp) return;
          const cells = comp.grid[0] * comp.grid[1] * comp.grid[2];
          if (cells > LIVE_CELLS && !force) {
            if (run === wholeRun.current) {
              setWhole((w) => ({ ...w, status: "skipped", cells, comp: null }));
              setSettling(false);
            }
            return;
          }
          let report: SmoothReport | null = null;
          if (ui.smoothOn) {
            const r = smoothComposite(comp, layout.joints, ui.smooth);
            comp = r.comp;
            report = r.report;
          } else {
            report = smoothComposite(comp, [], { ...ui.smooth, approved: [] }).report;
          }
          const names = namesFor(shown, autoName);
          const bundle = await readComposite(comp);
          if (!bundle || run !== wholeRun.current) return;
          const tile = await compositeToTile(comp, layout.boxes, { name: "arrangement", doc: { ...shown, names }, withMeshes: false, bundle });
          if (run !== wholeRun.current) return;
          const summary = summarizeWhole(tile, layout, tileById);
          const seq = buildSequence(layout, rules);
          setWhole({ status: "ready", tile, summary, evidence: evidenceFor(tile, layout, comp.origin, seq, report), smooth: report, comp, cells });
          if (ui.smoothOn) setMeshes(compositeMeshes(comp, 1));
          else setMeshes(null);
          setSettling(false);
        } catch (err) {
          console.error("[arrange] whole analysis failed:", err);
          if (run === wholeRun.current) {
            setWhole((w) => ({ ...w, status: "idle" }));
            setSettling(false);
          }
        }
      }, 0);
    },
    [layout, shown, autoName, tileById, rules, ui.smoothOn, ui.smooth],
  );

  // re-run (debounced) when the arrangement or the smoothing changes
  useEffect(() => {
    const t = setTimeout(() => runWhole(forceFull.current), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, ui.smoothOn, smoothSig, ui.rules.levelTolerance]);

  const evidence = useMemo(() => whole.evidence.find((e) => e.key === evidenceKey) ?? null, [whole.evidence, evidenceKey]);

  // ---- saved arrangements ----
  const thumb = useCallback(async (): Promise<string | undefined> => {
    const h = viewportHandle.current;
    const pose = viewportApi.current?.getPose();
    if (!h || !pose) return undefined;
    try {
      const blob = await capturePosePng(h, pose, { width: 360, height: 240, background: "#000000" });
      // a small JPEG: the saved list lives in the project's state, so keep each thumbnail to a few KB
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 160;
      c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c.toDataURL("image/jpeg", 0.72);
    } catch {
      return undefined;
    }
  }, []);

  // a thumbnail for the saved list, refreshed a moment after the arrangement settles
  useEffect(() => {
    if (!ui.currentId || !doc.pieces.length) return;
    const t = setTimeout(async () => {
      const url = await thumb();
      if (url) setUi((prev) => ({ ...prev, saved: prev.saved.map((s) => (s.id === prev.currentId ? { ...s, thumb: url } : s)) }));
    }, 2600);
    return () => clearTimeout(t);
  }, [doc, ui.currentId, thumb, setUi]);

  const newArrangement = useCallback(() => {
    saveBeforeNew();
    setUi((prev) => ({ ...prev, current: emptyDoc(), currentId: null, currentName: `Arrangement ${prev.saved.length + 2}` }));
    hist.reset(emptyDoc());
    setSelState(new Set());
    setBaselineDoc(null);
    setWhy("");
    setNotes([]);
  }, [saveBeforeNew, setUi, hist]);

  const openArrangement = useCallback(
    (id: string) => {
      const entry = ui.saved.find((s) => s.id === id);
      if (!entry) return;
      saveBeforeNew();
      setUi((prev) => ({ ...prev, current: entry.doc, currentId: entry.id, currentName: entry.name, gen: entry.gen ?? prev.gen, priorities: entry.priorities ?? prev.priorities, rules: entry.rules ?? prev.rules, site: entry.site ?? prev.site, smooth: entry.smooth ?? prev.smooth }));
      hist.reset(entry.doc);
      setSelState(new Set());
      setBaselineDoc(null);
      refit();
    },
    [ui.saved, saveBeforeNew, setUi, hist, refit],
  );
  const deleteArrangement = useCallback(
    (id: string) => {
      const wasCurrent = ui.currentId === id;
      setUi((prev) => ({ ...prev, saved: prev.saved.filter((s) => s.id !== id), ...(prev.currentId === id ? { currentId: null, current: emptyDoc() } : {}) }));
      if (wasCurrent) {
        hist.reset(emptyDoc());
        setSelState(new Set());
        setBaselineDoc(null);
      }
    },
    [ui.currentId, setUi, hist],
  );
  const duplicateArrangement = useCallback(
    (id: string) => {
      setUi((prev) => {
        const s = prev.saved.find((x) => x.id === id);
        if (!s) return prev;
        return { ...prev, saved: [...prev.saved, { ...s, id: `a${Date.now().toString(36)}`, name: `${s.name} copy`, createdAt: Date.now(), updatedAt: Date.now(), tileId: undefined }] };
      });
    },
    [setUi],
  );
  const renameArrangement = useCallback(
    (id: string, name: string) => setUi((prev) => ({ ...prev, currentName: prev.currentId === id ? name : prev.currentName, saved: prev.saved.map((s) => (s.id === id ? { ...s, name } : s)) })),
    [setUi],
  );

  const addAsTile = useCallback(async () => {
    if (!valid) {
      toast.error("Fix the disconnected or overlapping pieces first (see Warnings).");
      const bad = new Set<string>([...layout.islands.flat(), ...layout.overlaps.flat()]);
      setHighlight(bad);
      return;
    }
    setBusy("Building the tile");
    try {
      let comp = buildComposite(layout.boxes)!;
      if (ui.smoothOn) comp = smoothComposite(comp, layout.joints, ui.smooth).comp;
      const entry = ui.saved.find((s) => s.id === ui.currentId);
      const names = namesFor(doc, autoName);
      const tile = await compositeToTile(comp, layout.boxes, { name: ui.currentName, doc: { ...doc, names }, withMeshes: true, id: entry?.tileId });
      addProjectTile(tile);
      setActiveTile(tile.id);
      setUi((prev) => {
        const id = prev.currentId ?? `a${Date.now().toString(36)}`;
        const base: SavedArrangement = prev.saved.find((s) => s.id === id) ?? { id, name: prev.currentName, createdAt: Date.now(), updatedAt: Date.now(), doc: prev.current, gen: prev.gen, priorities: prev.priorities, rules: prev.rules, site: prev.site, smooth: prev.smooth };
        const next = { ...base, tileId: tile.id, updatedAt: Date.now() };
        return { ...prev, currentId: id, saved: prev.saved.some((s) => s.id === id) ? prev.saved.map((s) => (s.id === id ? next : s)) : [...prev.saved, next] };
      });
      toast.success(`Added "${tile.name}" to the tile bank. Open it in the Viewer to compare.`);
      runWhole(forceFull.current);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the tile.");
    } finally {
      setBusy(null);
    }
  }, [valid, layout, ui.smoothOn, ui.smooth, ui.saved, ui.currentId, ui.currentName, doc, autoName, addProjectTile, setActiveTile, setUi, runWhole]);

  // ---- compare ----
  const diff = useMemo(() => {
    const added = new Set<string>();
    const removed = new Set<string>();
    const moved = new Set<string>();
    if (baseline) {
      const b = new Map(baseline.pieces.map((p) => [p.id, p]));
      const c = new Map(doc.pieces.map((p) => [p.id, p]));
      for (const p of doc.pieces) {
        const o = b.get(p.id);
        if (!o) added.add(p.id);
        else if (o.tileId !== p.tileId || o.rotZ !== p.rotZ || o.mirrorX !== p.mirrorX || o.pos.join() !== p.pos.join()) moved.add(p.id);
      }
      for (const p of baseline.pieces) if (!c.has(p.id)) removed.add(p.id);
    }
    return { added, removed, moved };
  }, [baseline, doc]);

  // ---- keyboard ----
  const nudge = useCallback((dx: number, dy: number, dz: number) => moveSelected([dx, dy, dz]), [moveSelected]);
  const hasSel = sel.size > 0;
  const defs: ShortcutDef[] = [
    { keys: "Ctrl+Z", label: "Undo", group: "Edit", run: hist.undo },
    { keys: "Ctrl+Shift+Z", label: "Redo", group: "Edit", run: hist.redo },
    { keys: "Ctrl+Y", label: "Redo", group: "hidden", run: hist.redo },
    { keys: "G", label: "Generate", group: "Build", run: generate },
    { keys: "Shift+Click", label: "Multi-select", group: "Select" },
    { keys: "Drag", label: "Move piece", group: "Select" },
    { keys: "B", label: mode === "box" ? "Orbit" : "Box select", group: "Select", run: () => setMode(mode === "box" ? "orbit" : "box") },
    { keys: "Ctrl+A", label: "Select all", group: "Select", run: () => setSelState(new Set(doc.pieces.map((p) => p.id))) },
    { keys: "H", label: mode === "pan" ? "Select tool" : "Pan tool", group: "View", run: () => setMode(mode === "pan" ? "orbit" : "pan") },
    { keys: "Right-drag", label: "Pan", group: "View" },
    { keys: "Double-click", label: "Turn about here", group: "View" },
    { keys: "T", label: "Measure", group: "View", run: () => setMode(mode === "measure" ? "orbit" : "measure") },
    { keys: "E", label: "Mark entrance", group: "View", run: () => setMode(mode === "entrance" ? "orbit" : "entrance") },
    { keys: "F", label: "Fit view", group: "View", run: refit },
    { keys: "J", label: ui.showJoints ? "Hide joints" : "Show joints", group: "View", run: () => patchUi({ showJoints: !ui.showJoints }) },
    { keys: "Shift+L", label: ui.lattice ? "Free placement" : "Lattice mode", group: "View", run: () => patchUi({ lattice: !ui.lattice }) },
    { keys: "Escape", label: "Clear / exit tool", group: "Select", run: () => (mode !== "orbit" ? setMode("orbit") : suggestions ? clearSuggestions() : interlock ? setInterlock(null) : setSelState(new Set())) },
    ...(hasSel
      ? ([
          { keys: "R", label: "Turn", group: "Edit", run: () => rotateSelected(1) },
          { keys: "M", label: "Mirror", group: "Edit", run: mirrorSelected },
          { keys: "L", label: "Lock", group: "Edit", run: lockSelected },
          { keys: "Delete", label: "Remove", group: "Edit", run: removeSelected },
          { keys: "Backspace", label: "Remove", group: "hidden", run: removeSelected },
          { keys: "Ctrl+D", label: "Duplicate", group: "Edit", run: duplicateSelected },
          { keys: "Ctrl+G", label: "Group", group: "Edit", run: groupSelected },
          { keys: "Ctrl+Shift+G", label: "Ungroup", group: "Edit", run: ungroupSelected },
          { keys: "S", label: "Suggest next", group: "Help", run: () => suggestForPiece([...sel][0] ?? null) },
          { keys: "ArrowLeft", label: "Nudge 1 ft", group: "Move", run: () => nudge(-1, 0, 0) },
          { keys: "ArrowRight", label: "Nudge 1 ft", group: "hidden", run: () => nudge(1, 0, 0) },
          { keys: "ArrowUp", label: "Nudge 1 ft", group: "hidden", run: () => nudge(0, 1, 0) },
          { keys: "ArrowDown", label: "Nudge 1 ft", group: "hidden", run: () => nudge(0, -1, 0) },
          { keys: "Shift+ArrowLeft", label: "Nudge 10 ft", group: "Move", run: () => nudge(-10, 0, 0) },
          { keys: "Shift+ArrowRight", label: "Nudge 10 ft", group: "hidden", run: () => nudge(10, 0, 0) },
          { keys: "Shift+ArrowUp", label: "Nudge 10 ft", group: "hidden", run: () => nudge(0, 10, 0) },
          { keys: "Shift+ArrowDown", label: "Nudge 10 ft", group: "hidden", run: () => nudge(0, -10, 0) },
          { keys: "PageUp", label: "Up one storey", group: "Move", run: () => nudge(0, 0, 10) },
          { keys: "PageDown", label: "Down one storey", group: "Move", run: () => nudge(0, 0, -10) },
          { keys: "I", label: "Invert selection", group: "Select", run: invertSelection },
          { keys: "C", label: "Select connected", group: "Select", run: selectConnected },
        ] satisfies ShortcutDef[])
      : []),
  ];
  useShortcuts("arrange", defs);

  const value: ArrangeController = {
    tiles,
    tileById,
    bank,
    ui,
    setUi,
    patchUi,
    doc,
    shown,
    layout,
    joints,
    warnings,
    sequence,
    autoName,
    nameOf,
    entrance,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    undo: hist.undo,
    redo: hist.redo,
    commit: hist.commit,
    tryCommit,
    sel,
    setSel,
    selJoint,
    setSelJoint,
    pick,
    highlight,
    setHighlight,
    mode,
    setMode,
    measure,
    addMeasurePoint,
    levelCut,
    setLevelCut,
    fitKey,
    refit,
    viewportApi,
    viewportHandle,
    focusOn,
    pieceAt,
    selectionBoxes,
    onDragStart,
    onDrag,
    onDragEnd,
    snapNote,
    dragging: !!dragDoc,
    addTile,
    removeSelected,
    replaceSelected,
    rotateSelected,
    mirrorSelected,
    lockSelected,
    duplicateSelected,
    moveSelected,
    setPiecePos,
    setPieceScale,
    align,
    groupSelected,
    ungroupSelected,
    selectCategory,
    selectConnected,
    invertSelection,
    setEntrance,
    rename,
    autoNameAll,
    rateJoint,
    setConnector,
    busy,
    loading: busy && ["Generating", "Growing", "Regenerating", "Building the tile"].includes(busy) ? `${busy}…` : settling ? "Reading the building…" : null,
    notes,
    why,
    generate,
    growMore,
    regenerate,
    genContext,
    suggestions,
    suggestFor: suggestForPiece,
    fillGap,
    suggestReplace,
    applySuggestionAt,
    previewSuggestion,
    setPreviewSuggestion,
    clearSuggestions,
    ghosts,
    whole,
    runWhole,
    meshes,
    evidenceKey,
    setEvidenceKey,
    evidence,
    newArrangement,
    openArrangement,
    deleteArrangement,
    duplicateArrangement,
    renameArrangement,
    addAsTile,
    valid,
    pending,
    resolvePending,
    interlock,
    setInterlock,
    compare,
    setCompare,
    baseline,
    setBaseline,
    clearBaseline,
    diff,
    viewportHidden: hidden,
    setViewportHidden,
    thumb,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

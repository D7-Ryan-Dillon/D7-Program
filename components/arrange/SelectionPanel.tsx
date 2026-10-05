"use client";

import {
  AlignCenterHorizontal,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  Copy,
  FlipHorizontal2,
  Group,
  Lock,
  LockOpen,
  MapPin,
  RotateCw,
  Trash2,
  Ungroup,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TileThumbnail } from "@/components/shared/TileThumbnail";
import { cn } from "@/lib/utils";
import { categoryOf } from "@/lib/arrange/orient";
import { CATEGORY_LABEL } from "@/lib/arrange/types";
import { Cap, Chip, Num } from "@/components/arrange/ui";
import { useArrange } from "@/components/arrange/useArrange";
import type { AlignMode } from "@/lib/arrange/ops";

const IconBtn = ({
  label,
  onClick,
  active,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "flex h-8 flex-1 items-center justify-center rounded-md border-hair text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground disabled:opacity-40",
      active && "border-magenta/60 bg-magenta/15 text-foreground",
    )}
  >
    {children}
  </button>
);

/** The selected piece or pieces: move, turn, mirror, lock, replace, group, align. Shift-click adds to the selection; drag a box with B. */
export function SelectionPanel() {
  const A = useArrange();
  const pieces = A.doc.pieces.filter((p) => A.sel.has(p.id));
  if (!pieces.length)
    return (
      <p className="text-xs text-muted-foreground">
        Click a piece to select it. Shift-click adds more; B drags a box.
        Everything stays editable after generating.
      </p>
    );

  const one = pieces.length === 1 ? pieces[0] : null;
  const tile = one ? A.tileById.get(one.tileId) : undefined;
  const allLocked = pieces.every((p) => p.locked);
  const grouped = pieces.some((p) => p.group);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {tile && <TileThumbnail glbUrl={tile.glbUrl} size={30} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">
            {one ? A.nameOf(one.id) : `${pieces.length} pieces selected`}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {tile
              ? `${tile.name} · ${CATEGORY_LABEL[categoryOf(tile)]}`
              : [...new Set(pieces.map((p) => A.tileById.get(p.tileId)?.name))]
                  .slice(0, 3)
                  .join(", ")}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <IconBtn label="Turn 90° (R)" onClick={() => A.rotateSelected(1)}>
          <RotateCw className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Mirror (M)" onClick={A.mirrorSelected}>
          <FlipHorizontal2 className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label={allLocked ? "Unlock (L)" : "Lock (L)"}
          onClick={A.lockSelected}
          active={allLocked}
        >
          {allLocked ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <LockOpen className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        <IconBtn
          label="Duplicate (Ctrl+D)"
          onClick={A.duplicateSelected}
          disabled={pieces.length !== 1}
        >
          <Copy className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Remove (Delete)" onClick={A.removeSelected}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>

      {one && (
        <div className="space-y-2">
          <Cap>Position (ft, low corner)</Cap>
          <div className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((l, k) => (
              <Num
                key={l}
                label={l}
                value={one.pos[k]}
                step={0.5}
                onChange={(v) => {
                  const p: [number, number, number] = [...one.pos];
                  p[k] = v;
                  A.setPiecePos(one.id, p);
                }}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <Chip
              active={A.layout.entranceId === one.id}
              onClick={() =>
                A.setEntrance(A.doc.entranceId === one.id ? null : one.id)
              }
            >
              <MapPin className="mr-1 inline h-3 w-3" />
              Entrance
            </Chip>
          </div>
          {A.bank.length > 0 && (
            <div className="space-y-1">
              <Cap>Replace with</Cap>
              <Select
                className="h-7 w-full text-[11px]"
                value=""
                onChange={(e) =>
                  e.target.value && A.replaceSelected(e.target.value)
                }
                aria-label="Replace with another tile"
              >
                <option value="">Choose a tile…</option>
                {A.bank
                  .filter((t) => t.id !== one.tileId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          {A.ui.advanced && (
            <Num
              label="Scale"
              value={one.scale}
              min={0.5}
              max={2}
              step={0.1}
              decimals={2}
              onChange={(v) => A.setPieceScale(one.id, v)}
            />
          )}
        </div>
      )}

      {pieces.length > 1 && (
        <details className="space-y-2" open>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-label text-muted-foreground hover:text-foreground">
            Move, align and spread
          </summary>
          <div className="space-y-2 pt-2">
            <Cap>Move together</Cap>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["←", [-10, 0, 0]],
                  ["→", [10, 0, 0]],
                  ["Up", [0, 0, 10]],
                  ["↓", [0, -10, 0]],
                  ["↑", [0, 10, 0]],
                  ["Down", [0, 0, -10]],
                ] as [string, [number, number, number]][]
              ).map(([l, d]) => (
                <Button
                  key={l}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => A.moveSelected(d)}
                  title={`Move 10 ft`}
                >
                  {l} 10 ft
                </Button>
              ))}
            </div>
            <Cap>Align and spread</Cap>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [
                    "x-min",
                    "X min",
                    <AlignHorizontalJustifyStart
                      key="a"
                      className="h-3.5 w-3.5"
                    />,
                  ],
                  [
                    "x-center",
                    "X mid",
                    <AlignCenterHorizontal key="b" className="h-3.5 w-3.5" />,
                  ],
                  [
                    "x-max",
                    "X max",
                    <AlignHorizontalJustifyEnd
                      key="c"
                      className="h-3.5 w-3.5"
                    />,
                  ],
                ] as [AlignMode, string, React.ReactNode][]
              ).map(([m, l, icon]) => (
                <IconBtn
                  key={m}
                  label={`Align ${l}`}
                  onClick={() => A.align(m)}
                >
                  {icon}
                </IconBtn>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  "y-min",
                  "y-center",
                  "y-max",
                  "z-min",
                  "z-max",
                  "x-even",
                  "y-even",
                  "z-even",
                ] as AlignMode[]
              ).map((m) => (
                <Chip
                  key={m}
                  onClick={() => A.align(m)}
                  title={m.endsWith("even") ? "Spread evenly" : `Align ${m}`}
                >
                  {m.replace("-", " ")}
                </Chip>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={A.groupSelected}
              >
                <Group className="mr-1.5 h-3.5 w-3.5" />
                Group
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={!grouped}
                onClick={A.ungroupSelected}
              >
                <Ungroup className="mr-1.5 h-3.5 w-3.5" />
                Ungroup
              </Button>
            </div>
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-1">
        <Chip onClick={A.selectConnected}>Select connected (C)</Chip>
        <Chip onClick={A.invertSelection}>Invert (I)</Chip>
        <Chip onClick={() => A.setSel(new Set())}>Clear</Chip>
      </div>
    </div>
  );
}

/** All pieces in a list, to select or find one. */
export function PlacedList() {
  const A = useArrange();
  const counts = new Map<string, number>();
  for (const p of A.doc.pieces)
    counts.set(p.tileId, (counts.get(p.tileId) ?? 0) + 1);
  if (!A.doc.pieces.length)
    return <p className="text-xs text-muted-foreground">Nothing placed yet.</p>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 pb-1">
        {(["gathering", "office", "lobby"] as const).map((c) => (
          <Chip key={c} onClick={() => A.selectCategory(c)}>
            All {CATEGORY_LABEL[c].toLowerCase()}
          </Chip>
        ))}
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {A.doc.pieces.map((p) => {
          const t = A.tileById.get(p.tileId);
          return (
            <button
              key={p.id}
              type="button"
              onClick={(e) => A.pick(p.id, e.shiftKey)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border-hair px-2 py-1.5 text-left text-xs",
                A.sel.has(p.id)
                  ? "border-magenta/50 bg-magenta/10"
                  : "hover:border-white/25",
              )}
            >
              {t && <TileThumbnail glbUrl={t.glbUrl} size={20} />}
              <span className="min-w-0 flex-1 truncate">{A.nameOf(p.id)}</span>
              {p.locked && (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {p.group && (
                <Group className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

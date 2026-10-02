"use client";

import { ChevronDown, Lock, LockOpen, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TileThumb } from "@/components/sections/TileBank";
import type { BankTile } from "@/lib/sections/tileLibrary";

/** One face row of the cube/hex builder: the face name, a thumbnail of the
 * tile currently on it (so you can see what's where at a glance, without
 * decoding a name), and -- when opened -- a grid of thumbnails to choose
 * from instead of a text-only dropdown. */
export function FaceTilePicker({
  face,
  assigned,
  options,
  open,
  onToggle,
  onChange,
  turns,
  onRotate,
  locked,
  onLock,
}: {
  face: string;
  assigned: BankTile | undefined;
  options: BankTile[];
  open: boolean;
  onToggle: () => void;
  onChange: (name: string | undefined) => void;
  /** Quarter turns (0-3) given to this face's tile. */
  turns: number;
  onRotate: () => void;
  /** A locked face keeps its tile and turn through Auto-fill. */
  locked: boolean;
  onLock: () => void;
}) {
  return (
    <div className="rounded-lg border-hair">
      {/* A div, not a <button>: the thumbnail inside is itself a <button> (shared TileThumb), and buttons can't nest. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 p-1.5 text-left"
        aria-expanded={open}
      >
        <span className="w-14 shrink-0 font-mono text-[11px] uppercase text-muted-foreground">{face}</span>
        {assigned ? (
          <span className="pointer-events-none block h-11 w-11 shrink-0 transition-transform" style={{ transform: `rotate(${turns * 90}deg)` }}>
            <TileThumb tile={assigned} selected={false} onClick={() => {}} />
          </span>
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/20 text-[10px] text-muted-foreground">empty</span>
        )}
        <span className={cn("min-w-0 flex-1 truncate text-xs", assigned ? "text-foreground" : "text-muted-foreground")}>{assigned ? assigned.displayName : "Choose a tile"}</span>
        {assigned && (
          <button
            type="button"
            title="Turn this tile 90 degrees"
            aria-label={`Turn the tile on ${face} 90 degrees`}
            onClick={(e) => {
              e.stopPropagation();
              onRotate();
            }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          title={locked ? "Locked: Auto-fill keeps this face" : "Unlocked: Auto-fill may replace this face"}
          aria-label={locked ? `Unlock ${face}` : `Lock ${face}`}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation();
            onLock();
          }}
          className={cn("shrink-0 rounded p-1 transition-colors hover:bg-white/10", locked ? "text-magenta" : "text-muted-foreground hover:text-foreground")}
        >
          {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </button>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>
      {open && (
        <div className="border-t border-white/10 p-2">
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-[9px] text-muted-foreground transition-colors hover:text-foreground",
                !assigned ? "border-magenta/60" : "border-white/20 hover:border-white/40",
              )}
            >
              <X className="h-3.5 w-3.5" />
              none
            </button>
            {options.map((tile) => (
              <div key={tile.name} className="min-w-0 space-y-0.5">
                <TileThumb tile={tile} selected={assigned?.name === tile.name} onClick={() => onChange(tile.name)} />
                <div className="truncate text-center text-[9px] text-muted-foreground">{tile.displayName}</div>
              </div>
            ))}
          </div>
          {!options.length && <p className="pt-1 text-[11px] text-muted-foreground">No tiles to pick from -- check some in Bank &amp; cleanup, or switch to the whole bank.</p>}
        </div>
      )}
    </div>
  );
}

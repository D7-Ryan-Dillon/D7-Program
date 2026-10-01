"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BankTile } from "@/lib/sections/tileLibrary";

function TileThumb({ tile, selected, onClick }: { tile: BankTile; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative block aspect-square w-full overflow-hidden rounded-lg border-hair transition-colors",
        selected ? "border-magenta/60" : "hover:border-white/25",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a user-supplied/local photo, not an optimizable remote asset */}
      <img src={tile.src} alt={tile.name} className="absolute inset-0 h-full w-full object-cover" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-70 mix-blend-screen">
        {tile.proposal.shapes.map((s, i) => (
          <path key={i} d={s.d} fill="white" fillRule="evenodd" />
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-1.5 py-1 font-mono text-[10px] uppercase tracking-label text-white opacity-0 transition-opacity group-hover:opacity-100">
        <span className="truncate">{tile.name}</span>
        {tile.corrected && <span className="text-cyan-400">corrected</span>}
      </div>
    </button>
  );
}

export function TileBank({
  tiles,
  selected,
  onSelect,
  onAddFiles,
}: {
  tiles: BankTile[];
  selected: Set<string>;
  onSelect: (name: string, mode: "edit" | "toggle") => void;
  onAddFiles: (files: FileList) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">
          {tiles.length} tile(s) · {selected.size} selected for building
        </div>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Add photo
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {tiles.map((tile) => (
          <div key={tile.name} className="space-y-1">
            <TileThumb tile={tile} selected={selected.has(tile.name)} onClick={() => onSelect(tile.name, "edit")} />
            <label className="flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={selected.has(tile.name)} onChange={() => onSelect(tile.name, "toggle")} />
              use in builder
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

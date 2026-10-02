"use client";

import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A small icon button that rolls a fresh random seed -- used next to every
 * real editable seed field on the site (the Sections builder's Variation
 * Seed, the Arrange tab's Seed). Not shown next to the Viewer tab's "Seed"
 * stat, which is read-only historical metadata from a real export, not a
 * live input. */
export function ShuffleSeedButton({ onShuffle }: { onShuffle: (seed: number) => void }) {
  return (
    <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Shuffle seed" onClick={() => onShuffle(Math.floor(Math.random() * 1_000_000))}>
      <Shuffle className="h-3.5 w-3.5" />
    </Button>
  );
}

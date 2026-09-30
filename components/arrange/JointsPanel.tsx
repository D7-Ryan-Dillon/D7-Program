"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ratingFor } from "@/lib/arrange/joints";
import type { Joint } from "@/lib/arrange/types";

const RATING_COLOR: Record<ReturnType<typeof ratingFor>, string> = {
  interlocks: "text-emerald-400",
  partial: "text-orange",
  poor: "text-destructive",
  sealed: "text-muted-foreground",
};

export function JointsPanel({
  joints,
  selectedJointId,
  onRate,
  onSelect,
  onRegenerate,
}: {
  joints: Joint[];
  selectedJointId?: string | null;
  onRate: (jointId: string, rating: "good" | "bad" | null) => void;
  onSelect: (jointId: string) => void;
  onRegenerate: () => void;
}) {
  const badCount = joints.filter((j) => j.rating === "bad").length;

  if (!joints.length) {
    return <p className="text-xs text-muted-foreground">No joints yet — auto-generate an assembly first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {joints.map((j, i) => {
          const rating = ratingFor(j.score);
          return (
            <div
              key={j.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(j.id)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(j.id)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-hair px-2.5 py-1.5 text-left text-xs transition-colors",
                selectedJointId === j.id ? "border-magenta/50 bg-magenta/10" : "hover:border-white/25",
              )}
            >
              <div>
                <div>
                  Joint {i + 1} · {j.face}
                </div>
                <div className={cn("font-mono", RATING_COLOR[rating])}>
                  {j.score === null ? "sealed" : `${j.score.toFixed(0)} · ${rating}`}
                </div>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  aria-label="Mark good"
                  onClick={() => onRate(j.id, j.rating === "good" ? null : "good")}
                  className={cn("rounded-full p-1.5 hover:bg-white/10", j.rating === "good" && "bg-emerald-400/20 text-emerald-400")}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Mark bad"
                  onClick={() => onRate(j.id, j.rating === "bad" ? null : "bad")}
                  className={cn("rounded-full p-1.5 hover:bg-white/10", j.rating === "bad" && "bg-destructive/20 text-destructive")}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="w-full" disabled={badCount === 0} onClick={onRegenerate}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Regenerate marked ({badCount})
      </Button>
    </div>
  );
}

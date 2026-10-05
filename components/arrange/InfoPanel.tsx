"use client";

import { useState } from "react";
import { Chip } from "@/components/arrange/ui";
import { WholePanel, WarningsPanel } from "@/components/arrange/WholePanel";
import { JointsPanel } from "@/components/arrange/JointsPanel";
import { SequencePanel, SpacesPanel } from "@/components/arrange/SequencePanel";
import { PlacedList } from "@/components/arrange/SelectionPanel";
import { useArrange } from "@/components/arrange/useArrange";

const TABS = [
  ["overview", "Overview"],
  ["joints", "Joints"],
  ["route", "Route"],
  ["pieces", "Pieces"],
] as const;
type TabKey = (typeof TABS)[number][0];

/** Everything the program has to say about the arrangement, in one place: the verdict, the joints, the route through the spaces, the placed pieces. */
export function InfoPanel() {
  const A = useArrange();
  const [which, setWhich] = useState<TabKey>("overview");
  const bad = A.warnings.some((w) => w.severity === "error");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <Chip key={k} active={which === k} onClick={() => setWhich(k)}>
            {label}
            {k === "overview" && A.warnings.length > 0 && <span className={bad ? "ml-1 text-destructive" : "ml-1 text-orange"}>{A.warnings.length}</span>}
            {k === "joints" && A.joints.length > 0 && <span className="ml-1 opacity-60">{A.joints.length}</span>}
            {k === "pieces" && A.doc.pieces.length > 0 && <span className="ml-1 opacity-60">{A.doc.pieces.length}</span>}
          </Chip>
        ))}
      </div>
      {which === "overview" && (
        <div className="space-y-4">
          <WholePanel />
          <div className="border-t border-border pt-3">
            <WarningsPanel />
          </div>
        </div>
      )}
      {which === "joints" && <JointsPanel />}
      {which === "route" && (
        <div className="space-y-4">
          <SequencePanel />
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-label text-muted-foreground hover:text-foreground">Rename the spaces</summary>
            <div className="pt-3">
              <SpacesPanel />
            </div>
          </details>
        </div>
      )}
      {which === "pieces" && <PlacedList />}
    </div>
  );
}

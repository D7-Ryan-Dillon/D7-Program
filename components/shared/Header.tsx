"use client";

import { LogOut, Loader2, Check, CloudOff } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { TabNav, type WorkspaceTabKey } from "@/components/shared/TabNav";
import { AddTilesButtons } from "@/components/shared/AddTilesButtons";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/project-store";

const SAVE_STATUS_LABEL: Record<string, string> = {
  loading: "loading…",
  saving: "saving…",
  saved: "saved",
  error: "couldn't save",
};

export function Header({ activeTab, onTabChange }: { activeTab: WorkspaceTabKey; onTabChange: (t: WorkspaceTabKey) => void }) {
  const { projectCode, leaveProject, saveStatus } = useProject();

  return (
    <header className="glass-panel-strong sticky top-4 z-20 mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 lg:mx-6">
      <div className="flex items-center gap-4">
        <Logo />
        {projectCode && (
          <span className="hidden rounded-full border-hair px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline">
            project&nbsp;<span className="text-foreground">{projectCode}</span>
          </span>
        )}
        {projectCode && saveStatus !== "idle" && (
          <span className="hidden items-center gap-1 font-mono text-[11px] text-muted-foreground sm:flex">
            {(saveStatus === "loading" || saveStatus === "saving") && <Loader2 className="h-3 w-3 animate-spin" />}
            {saveStatus === "saved" && <Check className="h-3 w-3 text-emerald-400" />}
            {saveStatus === "error" && <CloudOff className="h-3 w-3 text-destructive" />}
            {SAVE_STATUS_LABEL[saveStatus]}
          </span>
        )}
      </div>

      <TabNav active={activeTab} onChange={onTabChange} />

      <div className="flex items-center gap-2">
        <AddTilesButtons />
        <Button variant="ghost" size="sm" onClick={leaveProject} className="text-muted-foreground">
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Switch project
        </Button>
      </div>
    </header>
  );
}

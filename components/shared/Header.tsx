"use client";

import { LogOut, Loader2, Check, CloudOff } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { TabNav, type WorkspaceTabKey } from "@/components/shared/TabNav";
import { AddTilesButtons } from "@/components/shared/AddTilesButtons";
import { TileSwitcher } from "@/components/shared/TileSwitcher";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/project-store";

const SAVE_STATUS_LABEL: Record<string, string> = {
  loading: "loading…",
  saving: "saving…",
  saved: "saved",
  error: "couldn't save",
};

export function Header({ activeTab, onTabChange }: { activeTab: WorkspaceTabKey; onTabChange: (t: WorkspaceTabKey) => void }) {
  const { projectCode, leaveProject, saveStatus, saveError } = useProject();

  return (
    <header className="glass-panel-strong relative z-20 sm:sticky sm:top-4 mx-2 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3 sm:mx-4 sm:mt-4 sm:px-4 lg:mx-6">
      <div className="flex items-center gap-4">
        <Logo />
        {projectCode && (
          <span className="hidden rounded-full border-hair px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline">
            project&nbsp;<span className="text-foreground">{projectCode}</span>
          </span>
        )}
        {projectCode && saveStatus !== "idle" && (
          <span
            className="hidden items-center gap-1 font-mono text-[11px] text-muted-foreground sm:flex"
            title={saveStatus === "error" && saveError ? saveError : undefined}
          >
            {(saveStatus === "loading" || saveStatus === "saving") && <Loader2 className="h-3 w-3 animate-spin" />}
            {saveStatus === "saved" && <Check className="h-3 w-3 text-pink" />}
            {saveStatus === "error" && <CloudOff className="h-3 w-3 text-destructive" />}
            {SAVE_STATUS_LABEL[saveStatus]}
          </span>
        )}
      </div>

      <div className="order-last flex w-full min-w-0 justify-center lg:order-none lg:w-auto">
        <TabNav active={activeTab} onChange={onTabChange} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AddTilesButtons />
        <Button variant="ghost" size="sm" onClick={leaveProject} className="text-muted-foreground">
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Switch project
        </Button>
      </div>

      {/* the loaded tiles stay in the top bar (always on screen) on the tabs that work on one tile at a time */}
      {(activeTab === "viewer" || activeTab === "analysis") && (
        <div className="order-last w-full min-w-0">
          <TileSwitcher />
        </div>
      )}
    </header>
  );
}

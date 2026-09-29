"use client";

import { LogOut } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { TabNav, type WorkspaceTabKey } from "@/components/shared/TabNav";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/project-store";

export function Header({ activeTab, onTabChange }: { activeTab: WorkspaceTabKey; onTabChange: (t: WorkspaceTabKey) => void }) {
  const { projectCode, leaveProject } = useProject();

  return (
    <header className="glass-panel sticky top-4 z-20 mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 lg:mx-6">
      <div className="flex items-center gap-4">
        <Logo />
        {projectCode && (
          <span className="hidden rounded-full border-hair px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline">
            project&nbsp;<span className="text-foreground">{projectCode}</span>
          </span>
        )}
      </div>

      <TabNav active={activeTab} onChange={onTabChange} />

      <Button variant="ghost" size="sm" onClick={leaveProject} className="text-muted-foreground">
        <LogOut className="mr-1.5 h-3.5 w-3.5" />
        Switch project
      </Button>
    </header>
  );
}

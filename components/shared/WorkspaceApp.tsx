"use client";

import { ProjectProvider, useProject, useProjectUi } from "@/lib/project-store";
import { ErosionBackdrop } from "@/components/shared/ErosionBackdrop";
import { ProjectGate } from "@/components/shared/ProjectGate";
import { Header } from "@/components/shared/Header";
import { defaultWorkspaceUi, type WorkspaceUi } from "@/lib/workspaceUi";
import { ViewerTab } from "@/components/viewer/ViewerTab";
import { AnalysisTab } from "@/components/analysis/AnalysisTab";
import { ArrangeTab } from "@/components/arrange/ArrangeTab";
import { SectionsTab } from "@/components/sections/SectionsTab";
import { BoardsTab } from "@/components/boards/BoardsTab";
import { ShortcutProvider, useShortcuts } from "@/lib/shortcuts";
import { ShortcutBar } from "@/components/shared/ShortcutBar";

const TAB_ORDER: WorkspaceUi["tab"][] = ["viewer", "sections", "analysis", "arrange", "boards"];

function Workspace() {
  const { projectCode, tiles, activeTileId, setActiveTile, saveStatus } = useProject();
  // The tab you were on is remembered with the project.
  const [{ tab }, setWorkspaceUi] = useProjectUi<WorkspaceUi>("workspace", defaultWorkspaceUi);
  const setTab = (next: WorkspaceUi["tab"]) => setWorkspaceUi((prev) => ({ ...prev, tab: next }));

  // shortcuts every tab shares: jump between the tabs, step through the loaded tiles
  const stepTile = (d: number) => {
    if (!tiles.length) return;
    const i = Math.max(0, tiles.findIndex((t) => t.id === activeTileId));
    setActiveTile(tiles[(i + d + tiles.length) % tiles.length].id);
  };
  useShortcuts("global", [
    ...TAB_ORDER.map((t, i) => ({ keys: `Alt+${i + 1}`, label: ["Viewer", "Builder", "Analysis", "Arrange", "Boards"][i], group: "Go to tab", run: () => setTab(t) })),
    { keys: "[", label: "Previous tile", group: "Tiles", run: () => stepTile(-1) },
    { keys: "]", label: "Next tile", group: "Tiles", run: () => stepTile(1) },
  ]);

  // the animated backdrop belongs to the project-code screen only; the workspace itself is plain black
  if (!projectCode) {
    return (
      <>
        <ErosionBackdrop />
        <ProjectGate />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header activeTab={tab} onTabChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-4 sm:px-4 lg:px-6">
        {/* a tab opened before the project's saved state arrived would start from defaults and then overwrite it */}
        {saveStatus === "loading" ? (
          <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-label text-muted-foreground">Loading the project…</div>
        ) : (
          <>
            {tab === "viewer" && <ViewerTab />}
            {tab === "analysis" && <AnalysisTab />}
            {tab === "arrange" && <ArrangeTab />}
            {tab === "sections" && <SectionsTab />}
            {tab === "boards" && <BoardsTab />}
          </>
        )}
      </div>
      <ShortcutBar tab={tab} />
    </div>
  );
}

function TabScope() {
  const [{ tab }] = useProjectUi<WorkspaceUi>("workspace", defaultWorkspaceUi);
  return (
    <ShortcutProvider tab={tab}>
      <Workspace />
    </ShortcutProvider>
  );
}

export function WorkspaceApp() {
  return (
    <ProjectProvider>
      <TabScope />
    </ProjectProvider>
  );
}

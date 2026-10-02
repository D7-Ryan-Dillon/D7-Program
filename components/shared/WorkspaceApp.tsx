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

function Workspace() {
  const { projectCode } = useProject();
  // The tab you were on is remembered with the project.
  const [{ tab }, setWorkspaceUi] = useProjectUi<WorkspaceUi>("workspace", defaultWorkspaceUi);
  const setTab = (next: WorkspaceUi["tab"]) => setWorkspaceUi((prev) => ({ ...prev, tab: next }));

  if (!projectCode) return <ProjectGate />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header activeTab={tab} onTabChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-4 sm:px-4 lg:px-6">
        {tab === "viewer" && <ViewerTab />}
        {tab === "analysis" && <AnalysisTab />}
        {tab === "arrange" && <ArrangeTab />}
        {tab === "sections" && <SectionsTab />}
        {tab === "boards" && <BoardsTab />}
      </div>
    </div>
  );
}

export function WorkspaceApp() {
  return (
    <ProjectProvider>
      <ErosionBackdrop />
      <Workspace />
    </ProjectProvider>
  );
}

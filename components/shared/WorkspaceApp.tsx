"use client";

import { useState } from "react";
import { ProjectProvider, useProject } from "@/lib/project-store";
import { ErosionBackdrop } from "@/components/shared/ErosionBackdrop";
import { ProjectGate } from "@/components/shared/ProjectGate";
import { Header } from "@/components/shared/Header";
import type { WorkspaceTabKey } from "@/components/shared/TabNav";
import { ViewerTab } from "@/components/viewer/ViewerTab";
import { AnalysisTab } from "@/components/analysis/AnalysisTab";
import { ArrangeTab } from "@/components/arrange/ArrangeTab";

function Workspace() {
  const { projectCode } = useProject();
  const [tab, setTab] = useState<WorkspaceTabKey>("viewer");

  if (!projectCode) return <ProjectGate />;

  return (
    <div className="flex min-h-screen flex-col">
      <Header activeTab={tab} onTabChange={setTab} />
      <div className="flex-1 px-4 pb-6 pt-4 lg:px-6">
        {tab === "viewer" && <ViewerTab />}
        {tab === "analysis" && <AnalysisTab />}
        {tab === "arrange" && <ArrangeTab />}
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

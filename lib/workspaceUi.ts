import { useCallback } from "react";
import { useProjectUi } from "@/lib/project-store";
import type { WorkspaceTabKey } from "@/components/shared/TabNav";

/** What the workspace remembers about how it was left, per project: the tab
 * you were on, and which collapsible settings sections are open or shut
 * (keyed by section id; a missing key means "use that section's default"). */
export interface WorkspaceUi {
  tab: WorkspaceTabKey;
  sections: Record<string, boolean>;
}

export const defaultWorkspaceUi = (): WorkspaceUi => ({ tab: "viewer", sections: {} });

/** Open/closed state for one collapsible section. */
export function useSectionOpen(id: string, defaultOpen: boolean) {
  const [ui, setUi] = useProjectUi<WorkspaceUi>("workspace", defaultWorkspaceUi);
  const open = ui.sections[id] ?? defaultOpen;
  const setOpen = useCallback((next: boolean) => setUi((prev) => ({ ...prev, sections: { ...prev.sections, [id]: next } })), [id, setUi]);
  return [open, setOpen] as const;
}

/** Open or shut a whole group of sections at once ("Expand all" / "Collapse all"). */
export function useSectionGroup(ids: readonly string[]) {
  const [, setUi] = useProjectUi<WorkspaceUi>("workspace", defaultWorkspaceUi);
  const key = ids.join("|");
  return useCallback(
    (open: boolean) =>
      setUi((prev) => ({
        ...prev,
        sections: { ...prev.sections, ...Object.fromEntries(key.split("|").map((id) => [id, open])) },
      })),
    [key, setUi],
  );
}

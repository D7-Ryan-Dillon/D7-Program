"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ingestFromFileList, ingestFromZipFiles, type IngestResult } from "@/lib/ingest";
import { useProject } from "@/lib/project-store";

type InputWithDirProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

/** Always-available "add more tiles" entry point for the sticky header --
 * UploadZone only renders while no tile is loaded yet, so once a project has
 * at least one tile there was previously no way back into the file pickers. */
export function AddTilesButtons() {
  const { addTile } = useProject();
  const [busy, setBusy] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleIngestResult = async (task: Promise<IngestResult>) => {
    setBusy(true);
    try {
      const { tiles, errors } = await task;
      for (const tile of tiles) addTile(tile);
      if (tiles.length === 1) toast.success(`Loaded ${tiles[0].name}`);
      else if (tiles.length > 1) toast.success(`Loaded ${tiles.length} tiles`);
      for (const message of errors) toast.error(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that as a tile _analysis folder.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => folderInputRef.current?.click()}>
        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
        Add folder
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => zipInputRef.current?.click()}>
        <FileArchive className="mr-1.5 h-3.5 w-3.5" />
        Add .zip
      </Button>

      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        {...({ webkitdirectory: "true", directory: "true" } as InputWithDirProps)}
        multiple
        onChange={(e) => {
          if (e.target.files?.length) void handleIngestResult(ingestFromFileList(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleIngestResult(ingestFromZipFiles(e.target.files));
          e.target.value = "";
        }}
      />
    </>
  );
}

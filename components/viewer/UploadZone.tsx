"use client";

import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { UploadCloud, FolderOpen, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ingestFromDataTransferItems, ingestFromFileList, ingestFromZipFiles, type IngestResult } from "@/lib/ingest";
import { useProject } from "@/lib/project-store";

type InputWithDirProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

export function UploadZone() {
  const { addTile } = useProject();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer.items?.length) return;
    await handleIngestResult(ingestFromDataTransferItems(e.dataTransfer.items));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`glass-panel flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        dragOver ? "border-magenta/70" : "border-white/10"
      }`}
    >
      <UploadCloud className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-sm">Drag one or more tiles&apos; <span className="font-mono">_analysis</span> folders here</p>
        <p className="mt-1 text-xs text-muted-foreground">or choose below — a parent folder or multiple .zips work too</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => folderInputRef.current?.click()}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Choose folder
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => zipInputRef.current?.click()}>
          <FileArchive className="mr-1.5 h-3.5 w-3.5" />
          Choose .zip
        </Button>
      </div>

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
    </div>
  );
}

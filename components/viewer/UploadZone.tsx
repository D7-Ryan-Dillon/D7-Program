"use client";

import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { UploadCloud, FolderOpen, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ingestFromDataTransferItems, ingestFromFileList, ingestFromZipFile } from "@/lib/ingest";
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

  const handleTileResult = async (task: Promise<Awaited<ReturnType<typeof ingestFromFileList>>>) => {
    setBusy(true);
    try {
      const tile = await task;
      addTile(tile);
      toast.success(`Loaded ${tile.name}`);
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
    await handleTileResult(ingestFromDataTransferItems(e.dataTransfer.items));
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
        <p className="text-sm">Drag a tile&apos;s <span className="font-mono">_analysis</span> folder here</p>
        <p className="mt-1 text-xs text-muted-foreground">or choose it below — a .zip works too</p>
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
          if (e.target.files?.length) void handleTileResult(ingestFromFileList(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleTileResult(ingestFromZipFile(file));
          e.target.value = "";
        }}
      />
    </div>
  );
}

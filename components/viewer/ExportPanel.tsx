"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { downloadTextFile, tileToObjText } from "@/lib/exporters/objExport";
import { useProject } from "@/lib/project-store";
import type { ParsedTile } from "@/lib/types";
import type { MeshVisibility } from "@/components/viewer/ThreeViewport";

export function ExportPanel({ tile, visibility }: { tile: ParsedTile; visibility: MeshVisibility }) {
  const { updateTile } = useProject();
  const [busy, setBusy] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const downloadRecipe = () => {
    if (!tile.recipeText) return;
    downloadTextFile(`${tile.name}.recipe.json`, tile.recipeText, "application/json");
  };

  const copyRecipe = async () => {
    if (!tile.recipeText) return;
    await navigator.clipboard.writeText(tile.recipeText);
    toast.success("Recipe copied — paste into the engine's `recipe` input in Grasshopper");
  };

  const exportObj = async () => {
    setBusy(true);
    try {
      const text = await tileToObjText(tile.glbUrl, visibility, tile);
      downloadTextFile(`${tile.name}.obj`, text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export that mesh.");
    } finally {
      setBusy(false);
    }
  };

  const attachRecipe = async (file: File) => {
    const text = await file.text();
    try {
      JSON.parse(text);
    } catch {
      toast.error("That file isn't valid JSON — attach the recipe.json from this tile's _reference folder.");
      return;
    }
    updateTile(tile.id, { recipeText: text });
    toast.success("Recipe attached to this tile");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">Recipe</span>
        {tile.recipeText ? (
          <div className="flex gap-1.5">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="sm">View</Button>} />
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-mono text-sm">{tile.name}.recipe.json</DialogTitle>
                </DialogHeader>
                <pre className="max-h-[50vh] overflow-auto rounded-md bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
                  {tile.recipeText}
                </pre>
                <Button size="sm" variant="outline" onClick={copyRecipe}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy
                </Button>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={downloadRecipe}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => attachInputRef.current?.click()} className="text-muted-foreground">
            <FileUp className="mr-1.5 h-3.5 w-3.5" />
            Attach recipe.json
          </Button>
        )}
        <input
          ref={attachInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attachRecipe(file);
            e.target.value = "";
          }}
        />
      </div>
      {!tile.recipeText && (
        <p className="text-[11px] text-muted-foreground">
          This _analysis folder didn&apos;t include a recipe — only _reference folders do. Attach that tile&apos;s
          recipe.json to enable export.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">OBJ mesh</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportObj()}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download .obj
        </Button>
      </div>
    </div>
  );
}

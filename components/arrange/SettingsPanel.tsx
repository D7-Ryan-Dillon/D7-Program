"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import type { AutoGenerateSettings } from "@/lib/arrange/types";

export function SettingsPanel({
  settings,
  onChange,
  onGenerate,
  disabled,
}: {
  settings: AutoGenerateSettings;
  onChange: (s: AutoGenerateSettings) => void;
  onGenerate: () => void;
  disabled: boolean;
}) {
  const field = (key: keyof AutoGenerateSettings) => ({
    value: settings[key] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...settings, [key]: Number(e.target.value) }),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Amount</Label>
        <Input type="number" min={1} max={40} className="mt-1 font-mono" {...field("amount")} />
      </div>
      <div>
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Max copies of one piece</Label>
        <Input type="number" min={1} max={20} className="mt-1 font-mono" {...field("maxCopiesPerTile")} />
      </div>
      <div>
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Seed</Label>
        <Input type="number" className="mt-1 font-mono" {...field("seed")} />
      </div>
      <div className="flex items-center justify-between">
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Spine-first growth</Label>
        <Switch checked={settings.spineFirst} onCheckedChange={(v) => onChange({ ...settings, spineFirst: v })} />
      </div>
      <Button className="w-full" disabled={disabled} onClick={onGenerate}>
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        Auto-generate
      </Button>
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import { ShuffleSeedButton } from "@/components/shared/ShuffleSeedButton";
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
        <div className="mt-1 flex gap-1.5">
          <Input type="number" className="font-mono" {...field("seed")} />
          <ShuffleSeedButton onShuffle={(seed) => onChange({ ...settings, seed })} />
        </div>
      </div>
      <div>
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Scale range</Label>
        <div className="mt-1 flex items-center gap-2">
          <Input
            type="number"
            step={0.1}
            min={0.1}
            className="font-mono"
            value={settings.scaleMin}
            onChange={(e) => {
              const v = Math.max(0.1, Number(e.target.value) || 0.1);
              onChange({ ...settings, scaleMin: v, scaleMax: Math.max(v, settings.scaleMax) });
            }}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="number"
            step={0.1}
            min={settings.scaleMin}
            className="font-mono"
            value={settings.scaleMax}
            onChange={(e) => onChange({ ...settings, scaleMax: Math.max(settings.scaleMin, Number(e.target.value) || settings.scaleMin) })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Spine-first growth</Label>
        <Switch checked={settings.spineFirst} onCheckedChange={(v) => onChange({ ...settings, spineFirst: v })} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label className="font-mono text-[11px] uppercase tracking-label text-muted-foreground">Allow tilt rotation</Label>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Pieces may tip onto a side, not just spin flat</p>
        </div>
        <Switch checked={settings.allowTiltRotation} onCheckedChange={(v) => onChange({ ...settings, allowTiltRotation: v })} />
      </div>
      <Button className="w-full" disabled={disabled} onClick={onGenerate}>
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        Auto-generate
      </Button>
    </div>
  );
}

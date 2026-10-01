"use client";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "./ColorField";
import { FontPicker } from "./FontPicker";
import type { BoardConfig } from "@/lib/boards/types";

function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  decimals = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} />
    </label>
  );
}

/** A slider for coarse dragging (0.5in steps) paired with a free-form
 * number field for exact values down to the hundredth -- either one
 * updates the same value. */
function SliderWithExactInput({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={min}
            max={max}
            step={0.01}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
            }}
            className="h-6 w-16 px-1.5 text-[11px]"
          />
          <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} />
    </div>
  );
}

/** Up/down-arrow number field for a font size that's otherwise auto-fit --
 * empty means "auto". */
function OptionalSizeField({ label, valuePt, onChange }: { label: string; valuePt: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={4}
          max={400}
          placeholder="Auto"
          value={valuePt ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          className="h-7 w-20 px-1.5 text-[11px]"
        />
        <span className="font-mono text-[10px] text-muted-foreground">pt</span>
      </div>
    </label>
  );
}

export function BoardSettingsPanel({ config, onChange }: { config: BoardConfig; onChange: (patch: Partial<BoardConfig>) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Board name</span>
          <Input value={config.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8 text-xs" />
        </label>
        <SliderWithExactInput label="Width" value={config.widthIn} min={6} max={48} step={0.5} suffix="in" onChange={(widthIn) => onChange({ widthIn })} />
        <SliderWithExactInput label="Height" value={config.heightIn} min={6} max={48} step={0.5} suffix="in" onChange={(heightIn) => onChange({ heightIn })} />
        <p className="text-[10px] text-muted-foreground">
          {Math.round(config.widthIn * 300)}×{Math.round(config.heightIn * 300)}px at 300dpi
        </p>
        <ColorField label="Background" value={config.backgroundColor} onChange={(backgroundColor) => onChange({ backgroundColor })} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Layout</div>
        <NumberSlider label="Outline weight" value={config.outlineWidthPt} min={0.5} max={8} step={0.25} decimals={2} suffix="pt" onChange={(outlineWidthPt) => onChange({ outlineWidthPt })} />
        <NumberSlider label="Gap between tiles" value={config.gapIn} min={0} max={1} step={0.05} decimals={2} suffix="in" onChange={(gapIn) => onChange({ gapIn })} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Typography</div>
        <FontPicker value={config.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
        <ColorField label="Title color" value={config.titleColor} onChange={(titleColor) => onChange({ titleColor })} />
        <OptionalSizeField label="Title size" valuePt={config.titleFontSizePt} onChange={(titleFontSizePt) => onChange({ titleFontSizePt })} />
        <ColorField label="Descriptor text" value={config.descriptorColor} onChange={(descriptorColor) => onChange({ descriptorColor })} />
        <ColorField label="Highlighted descriptor" value={config.highlightColor} onChange={(highlightColor) => onChange({ highlightColor })} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Materials (whole board)</div>
        <ColorField label="Foam" value={config.foamColor} onChange={(foamColor) => onChange({ foamColor })} />
        <NumberSlider label="Foam opacity" value={Math.round(config.foamOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => onChange({ foamOpacity: v / 100 })} />
        <ColorField label="Void" value={config.voidColor} onChange={(voidColor) => onChange({ voidColor })} />
        <NumberSlider label="Void opacity" value={Math.round(config.voidOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => onChange({ voidOpacity: v / 100 })} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Caption text box</span>
          <Switch checked={config.textBox.enabled} onCheckedChange={(enabled) => onChange({ textBox: { ...config.textBox, enabled } })} />
        </div>
        {config.textBox.enabled && (
          <>
            <textarea
              value={config.textBox.text}
              onChange={(e) => onChange({ textBox: { ...config.textBox, text: e.target.value } })}
              className="h-16 w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs"
              placeholder="Caption text…"
            />
            <ColorField label="Text color" value={config.textBox.color} onChange={(color) => onChange({ textBox: { ...config.textBox, color } })} />
            <OptionalSizeField label="Text size" valuePt={config.captionFontSizePt} onChange={(captionFontSizePt) => onChange({ captionFontSizePt })} />
          </>
        )}
      </div>
    </div>
  );
}

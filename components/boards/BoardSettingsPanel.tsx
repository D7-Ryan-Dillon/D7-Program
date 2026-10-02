"use client";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "./ColorField";
import { FontPicker } from "./FontPicker";
import { NumberSlider } from "@/components/shared/NumberSlider";
import type { BoardConfig } from "@/lib/boards/types";

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
        <NumberSlider label="Outline weight" value={config.outlineWidthPt} min={0.01} max={8} step={0.01} decimals={2} suffix="pt" exact onChange={(outlineWidthPt) => onChange({ outlineWidthPt })} />
        <NumberSlider label="Gap X (columns)" value={config.gapXIn} min={0} max={3} step={0.05} decimals={2} suffix="in" onChange={(gapXIn) => onChange({ gapXIn })} />
        <NumberSlider label="Gap Y (rows)" value={config.gapYIn} min={0} max={3} step={0.05} decimals={2} suffix="in" onChange={(gapYIn) => onChange({ gapYIn })} />
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
        <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Outlines (whole board, per tile render)</div>
        <p className="text-[10px] text-muted-foreground">Default for every tile -- override one tile&rsquo;s own in its popup editor.</p>
        {(["foamOutline", "voidOutline"] as const).map((key) => {
          const label = key === "foamOutline" ? "Foam (outer shape)" : "Void";
          const setting = config[key];
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{label} outline</span>
                <Switch checked={setting.enabled} onCheckedChange={(enabled) => onChange({ [key]: { ...setting, enabled } })} />
              </div>
              {setting.enabled && (
                <>
                  <ColorField label="Color" value={setting.color} onChange={(color) => onChange({ [key]: { ...setting, color } })} />
                  <NumberSlider label="Opacity" value={Math.round(setting.opacity * 100)} min={5} max={100} suffix="%" onChange={(v) => onChange({ [key]: { ...setting, opacity: v / 100 } })} />
                  <NumberSlider label="Weight" value={setting.weightPt} min={0.01} max={8} step={0.01} decimals={2} suffix="pt" exact onChange={(weightPt) => onChange({ [key]: { ...setting, weightPt } })} />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Facet lines (whole board, per tile render)</div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Foam facet lines</span>
            <Switch checked={config.facetLines.enabled} onCheckedChange={(enabled) => onChange({ facetLines: { ...config.facetLines, enabled } })} />
          </div>
          {config.facetLines.enabled && (
            <>
              <ColorField label="Color" value={config.facetLines.color} onChange={(color) => onChange({ facetLines: { ...config.facetLines, color } })} />
              <NumberSlider label="Opacity" value={Math.round(config.facetLines.opacity * 100)} min={5} max={100} suffix="%" onChange={(v) => onChange({ facetLines: { ...config.facetLines, opacity: v / 100 } })} />
            </>
          )}
        </div>
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

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-label uppercase text-muted-foreground">Footer</span>
          <Switch checked={config.footer.enabled} onCheckedChange={(enabled) => onChange({ footer: { ...config.footer, enabled } })} />
        </div>
        {config.footer.enabled && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Left text</span>
              <Input
                value={config.footer.leftText}
                onChange={(e) => onChange({ footer: { ...config.footer, leftText: e.target.value } })}
                className="h-8 text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Right text</span>
              <Input
                value={config.footer.rightText}
                onChange={(e) => onChange({ footer: { ...config.footer, rightText: e.target.value } })}
                className="h-8 text-xs"
              />
            </label>
            <ColorField label="Line, text & logo color" value={config.footer.color} onChange={(color) => onChange({ footer: { ...config.footer, color } })} />
            <OptionalSizeField label="Text size" valuePt={config.footerFontSizePt} onChange={(footerFontSizePt) => onChange({ footerFontSizePt })} />
          </>
        )}
      </div>
    </div>
  );
}

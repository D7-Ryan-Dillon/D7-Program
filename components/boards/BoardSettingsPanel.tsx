"use client";

import { Select } from "@/components/ui/select";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "./ColorField";
import { FontPicker } from "./FontPicker";
import { NumberSlider } from "@/components/shared/NumberSlider";
import { Section } from "@/components/shared/Section";
import { useSectionGroup } from "@/lib/workspaceUi";
import { Segmented } from "@/components/shared/Segmented";
import { defaultBoardConfig, type BoardConfig, type BoardViewMode, type LabelMode } from "@/lib/boards/types";

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

const BOARD_SECTION_IDS = ["page", "layout", "views", "nametag", "catalogue", "typography", "descriptors", "materials", "outlines", "facets", "caption", "footer"].map((k) => `boards.${k}`);

/** One collapsible group of board settings, with its own Reset link and an optional on/off switch. */
function Group({
  id,
  title,
  defaultOpen = false,
  summary,
  onReset,
  extra,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  onReset?: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section
      id={`boards.${id}`}
      variant="inline"
      title={title}
      defaultOpen={defaultOpen}
      summary={summary}
      action={
        <>
          {extra}
          {onReset && (
            <button type="button" onClick={onReset} className="font-mono text-[10px] uppercase tracking-label text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" title="Put this group back to its defaults">
              Reset
            </button>
          )}
        </>
      }
    >
      {children}
    </Section>
  );
}

const LABEL_MODES: { value: LabelMode; label: string }[] = [
  { value: "short", label: "Short — gathering 4" },
  { value: "typology", label: "Typology — contained room…" },
  { value: "full", label: "Full — gathering 4 - contained room…" },
  { value: "custom", label: "Custom template" },
];

export function BoardSettingsPanel({ config, onChange, criteriaCount }: { config: BoardConfig; onChange: (patch: Partial<BoardConfig>) => void; criteriaCount: number | null }) {
  /** Puts the named top-level settings back to their defaults. */
  const reset = (...keys: (keyof BoardConfig)[]) => {
    const defaults = defaultBoardConfig();
    const patch: Record<string, unknown> = {};
    for (const k of keys) patch[k as string] = defaults[k];
    onChange(patch as Partial<BoardConfig>);
  };
  const setAll = useSectionGroup(BOARD_SECTION_IDS);
  const nt = config.nameTag;
  const cat = config.catalogue;
  const setNameTag = (patch: Partial<typeof nt>) => onChange({ nameTag: { ...nt, ...patch } });
  const setCatalogue = (patch: Partial<typeof cat>) => onChange({ catalogue: { ...cat, ...patch } });

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-3 font-mono text-[10px] uppercase tracking-label text-muted-foreground">
        <button type="button" onClick={() => setAll(true)} className="underline-offset-2 hover:text-foreground hover:underline">
          Expand all
        </button>
        <button type="button" onClick={() => setAll(false)} className="underline-offset-2 hover:text-foreground hover:underline">
          Collapse all
        </button>
      </div>

      <Group id="page" title="Page" defaultOpen summary={`${config.widthIn}×${config.heightIn} in`}>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Board name</span>
          <Input value={config.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8 text-xs" />
        </label>
        <div className="flex flex-wrap gap-1.5" aria-label="Page sizes">
          {[
            { w: 13.33, h: 7.5, label: "13.33 × 7.5" },
            { w: 22, h: 11, label: "22 × 11 (11 × 22 landscape)" },
            { w: 17, h: 11, label: "17 × 11" },
            { w: 36, h: 24, label: "36 × 24" },
          ].map((p) => (
            <button key={p.label} type="button" onClick={() => onChange({ widthIn: p.w, heightIn: p.h })} className={`rounded-full border px-2 py-0.5 text-[10px] ${config.widthIn === p.w && config.heightIn === p.h ? "border-magenta/60 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <SliderWithExactInput label="Width" value={config.widthIn} min={6} max={48} step={0.5} suffix="in" onChange={(widthIn) => onChange({ widthIn })} />
        <SliderWithExactInput label="Height" value={config.heightIn} min={6} max={48} step={0.5} suffix="in" onChange={(heightIn) => onChange({ heightIn })} />
        <p className="text-[10px] text-muted-foreground">
          {Math.round(config.widthIn * 300)}×{Math.round(config.heightIn * 300)}px at 300dpi
        </p>
        <ColorField label="Background" value={config.backgroundColor} onChange={(backgroundColor) => onChange({ backgroundColor })} />
      </Group>

      <Group id="layout" title="Layout" defaultOpen onReset={() => reset("outlineWidthPt", "gapXIn", "gapYIn")}>
        <NumberSlider label="Outline weight" value={config.outlineWidthPt} min={0.01} max={8} step={0.01} decimals={2} suffix="pt" exact onChange={(outlineWidthPt) => onChange({ outlineWidthPt })} />
        <NumberSlider label="Gap X (columns)" value={config.gapXIn} min={0} max={3} step={0.05} decimals={2} suffix="in" onChange={(gapXIn) => onChange({ gapXIn })} />
        <NumberSlider label="Gap Y (rows)" value={config.gapYIn} min={0} max={3} step={0.05} decimals={2} suffix="in" onChange={(gapYIn) => onChange({ gapYIn })} />
      </Group>

      <Group id="views" title="Tile views" summary={config.drawing.mode === "model" ? "3D" : config.drawing.mode} onReset={() => reset("drawing")}>
        <p className="text-[10px] text-muted-foreground">What every tile shows: the 3D render, or an automatic plan or section drawn from the tile (poche, on this board&rsquo;s background). Override one tile in the tile list.</p>
        <Segmented value={config.drawing.mode} options={[{ value: "model", label: "3D" }, { value: "plan", label: "Plan" }, { value: "section", label: "Section" }]} onChange={(mode) => onChange({ drawing: { ...config.drawing, mode: mode as BoardViewMode } })} />
        {config.drawing.mode === "plan" && (
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Floor</span>
            <Select className="h-7 w-40 text-[11px]" value={String(config.drawing.level ?? 1)} onChange={(e) => onChange({ drawing: { ...config.drawing, level: Number(e.target.value) } })} aria-label="Which floor to cut the plan through">
              <option value="1">Lowest level</option>
              <option value="2">Second level</option>
              <option value="3">Third level</option>
              <option value="0">Highest level</option>
            </Select>
          </label>
        )}
        {config.drawing.mode === "section" && (
          <>
            <Segmented value={config.drawing.axis} options={[{ value: "x", label: "Along X" }, { value: "y", label: "Along Y" }]} onChange={(axis) => onChange({ drawing: { ...config.drawing, axis: axis as "x" | "y" } })} />
            <NumberSlider label="Position" value={config.drawing.pos ?? 10} min={0.5} max={19.5} step={0.5} suffix=" ft" decimals={1} onChange={(pos) => onChange({ drawing: { ...config.drawing, pos } })} />
          </>
        )}
        {config.drawing.mode === "plan" && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Room names and areas</span>
            <Switch checked={config.drawing.labels} onCheckedChange={(labels) => onChange({ drawing: { ...config.drawing, labels } })} />
          </div>
        )}
      </Group>

      <Group id="nametag" title="Name tag" summary={nt.labelMode} onReset={() => reset("nameTag")}>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">Label text</span>
          <Select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={nt.labelMode} onChange={(e) => setNameTag({ labelMode: e.target.value as LabelMode })}>
            {LABEL_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        {nt.labelMode === "custom" && (
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Template — {"{category} {n} {typology} {version} {name}"}</span>
            <Input value={nt.template} onChange={(e) => setNameTag({ template: e.target.value })} className="h-8 text-xs" />
          </label>
        )}
        <NumberSlider label="Tag width" value={Math.round(nt.widthFraction * 100)} min={10} max={100} suffix="%" onChange={(v) => setNameTag({ widthFraction: v / 100 })} />
        <NumberSlider label="Tag height" value={Math.round(nt.heightFraction * 1000) / 10} min={3} max={25} step={0.1} decimals={1} suffix="%" onChange={(v) => setNameTag({ heightFraction: v / 100 })} />
        <NumberSlider label="Max lines" value={nt.maxLines} min={1} max={3} suffix="" onChange={(maxLines) => setNameTag({ maxLines })} />
        <NumberSlider label="Smallest text" value={nt.minFontPt} min={2} max={24} suffix="pt" exact onChange={(minFontPt) => setNameTag({ minFontPt })} />
        <p className="text-[10px] text-muted-foreground">Text wraps to the line limit, then shrinks to fit. Click a tile&rsquo;s tag on the board to set its own text, category, number or size.</p>
      </Group>

      <Group
        id="catalogue"
        title="Catalogue"
        summary={cat.enabled ? "on" : "off"}
        onReset={() => reset("catalogue")}
        extra={<Switch checked={cat.enabled} onCheckedChange={(enabled) => setCatalogue({ enabled })} />}
      >
        {!cat.enabled ? (
          <p className="text-[10px] text-muted-foreground">Off. Turn on for one row per category and one column per typology number.</p>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground">
              One row per category (gathering / office / lobby), one column per typology number 1–5, placed from each tile&rsquo;s name (or its tag). Two tiles of one typology stack into extra rows. The caption box is hidden in this layout.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Dashed placeholders</span>
              <Switch checked={cat.placeholders} onCheckedChange={(placeholders) => setCatalogue({ placeholders })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Row labels</span>
              <Switch checked={cat.showRowLabels} onCheckedChange={(showRowLabels) => setCatalogue({ showRowLabels })} />
            </div>
            {cat.showRowLabels && (
              <div className="space-y-1">
                {cat.rowLabels.map((text, i) => (
                  <Input key={i} value={text} onChange={(e) => setCatalogue({ rowLabels: cat.rowLabels.map((t, j) => (j === i ? e.target.value : t)) })} className="h-7 text-xs" aria-label={`Row ${i + 1} label`} />
                ))}
                <NumberSlider label="Row label band" value={cat.rowBandIn} min={0.3} max={4} step={0.05} decimals={2} suffix="in" onChange={(rowBandIn) => setCatalogue({ rowBandIn })} />
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Column labels</span>
              <Switch checked={cat.showColumnLabels} onCheckedChange={(showColumnLabels) => setCatalogue({ showColumnLabels })} />
            </div>
            {cat.showColumnLabels && (
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-1">
                  {cat.columnLabels.map((text, i) => (
                    <Input key={i} value={text} onChange={(e) => setCatalogue({ columnLabels: cat.columnLabels.map((t, j) => (j === i ? e.target.value : t)) })} className="h-7 px-1 text-center text-xs" aria-label={`Column ${i + 1} label`} />
                  ))}
                </div>
                <NumberSlider label="Column label band" value={cat.columnBandIn} min={0.15} max={2} step={0.05} decimals={2} suffix="in" onChange={(columnBandIn) => setCatalogue({ columnBandIn })} />
              </div>
            )}
            <ColorField label="Label colour" value={cat.labelColor} onChange={(labelColor) => setCatalogue({ labelColor })} />
            <OptionalSizeField label="Label size" valuePt={cat.labelFontPt} onChange={(labelFontPt) => setCatalogue({ labelFontPt })} />
          </>
        )}
      </Group>

      <Group id="typography" title="Typography" onReset={() => reset("fontFamily", "titleColor", "titleFontSizePt", "descriptorColor", "highlightColor")}>
        <FontPicker value={config.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
        <ColorField label="Title color" value={config.titleColor} onChange={(titleColor) => onChange({ titleColor })} />
        <OptionalSizeField label="Title size" valuePt={config.titleFontSizePt} onChange={(titleFontSizePt) => onChange({ titleFontSizePt })} />
        <ColorField label="Descriptor text" value={config.descriptorColor} onChange={(descriptorColor) => onChange({ descriptorColor })} />
        <ColorField label="Highlight color" value={config.highlightColor} onChange={(highlightColor) => onChange({ highlightColor })} />
      </Group>

      <Group id="descriptors" title="Descriptor page" onReset={() => reset("highlight", "descriptorHeadlines")}>
        <p className="text-[10px] text-muted-foreground">
          {criteriaCount === null ? "Lists every descriptor." : `Lists the ${criteriaCount} criteria carried forward in the Analysis tab.`}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Highlight top descriptors</span>
          <Switch checked={config.highlight.enabled} onCheckedChange={(enabled) => onChange({ highlight: { ...config.highlight, enabled } })} />
        </div>
        {config.highlight.enabled && (
          <NumberSlider
            label="How many highlighted"
            value={config.highlight.count}
            min={1}
            max={Math.max(1, criteriaCount ?? 12)}
            onChange={(count) => onChange({ highlight: { ...config.highlight, count } })}
          />
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground" title="The measured value under each bar, for example the tallest clear height. It does not always fit in a small tile.">Measured value under each bar</span>
          <Switch checked={config.descriptorHeadlines} onCheckedChange={(descriptorHeadlines) => onChange({ descriptorHeadlines })} aria-label="Show the measured value under each descriptor bar" />
        </div>
      </Group>

      <Group id="materials" title="Materials (whole board)" onReset={() => reset("foamColor", "voidColor", "foamOpacity", "voidOpacity")}>
        <ColorField label="Foam" value={config.foamColor} onChange={(foamColor) => onChange({ foamColor })} />
        <NumberSlider label="Foam opacity" value={Math.round(config.foamOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => onChange({ foamOpacity: v / 100 })} />
        <ColorField label="Void" value={config.voidColor} onChange={(voidColor) => onChange({ voidColor })} />
        <NumberSlider label="Void opacity" value={Math.round(config.voidOpacity * 100)} min={10} max={100} suffix="%" onChange={(v) => onChange({ voidOpacity: v / 100 })} />
      </Group>

      <Group id="outlines" title="Outlines (per tile render)" onReset={() => reset("foamOutline", "voidOutline")}>
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
      </Group>

      <Group id="facets" title="Facet lines (per tile render)" onReset={() => reset("facetLines")}>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Foam facet lines</span>
            <Switch checked={config.facetLines.enabled} onCheckedChange={(enabled) => onChange({ facetLines: { ...config.facetLines, enabled } })} />
          </div>
          {config.facetLines.enabled && (
            <>
              <ColorField label="Color" value={config.facetLines.color} onChange={(color) => onChange({ facetLines: { ...config.facetLines, color } })} />
              <NumberSlider label="Opacity" value={Math.round(config.facetLines.opacity * 100)} min={5} max={100} suffix="%" onChange={(v) => onChange({ facetLines: { ...config.facetLines, opacity: v / 100 } })} />
              <NumberSlider label="Weight" value={config.facetLines.weightPt} min={0.01} max={4} step={0.01} decimals={2} suffix="pt" exact onChange={(weightPt) => onChange({ facetLines: { ...config.facetLines, weightPt } })} />
            </>
          )}
        </div>
      </Group>

      <Group
        id="caption"
        title="Caption boxes"
        summary={config.textBox.enabled || config.textBox2.enabled ? [config.textBox.enabled && "page 1", config.textBox2.enabled && "page 2"].filter(Boolean).join(" + ") : "off"}
        onReset={() => reset("textBox", "textBox2", "captionFontSizePt")}
      >
        <p className="text-[10px] text-muted-foreground">An optional text box in the first cell of the grid: it starts at the title&apos;s left edge and level with the top of the tiles, and keeps the tiles&apos; gaps from the tile beside it and the tile below it. Each page has its own: turn on either or both, with different text. The cell is kept on both pages so the tiles do not move between them.</p>
        {([
          { key: "textBox", title: "Page 1 (tiles)" },
          { key: "textBox2", title: "Page 2 (descriptors)" },
        ] as const).map(({ key, title }) => {
          const box = config[key];
          const setBox = (patch: Partial<typeof box>) => onChange({ [key]: { ...box, ...patch } });
          return (
            <div key={key} className="space-y-1.5 rounded-md border-hair p-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-label text-muted-foreground">{title}</span>
                <Switch checked={box.enabled} onCheckedChange={(enabled) => setBox({ enabled })} aria-label={`Caption box on ${title}`} />
              </div>
              {box.enabled && (
                <>
                  <textarea
                    value={box.text}
                    onChange={(e) => setBox({ text: e.target.value })}
                    className="h-16 w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs"
                    placeholder="Caption text…"
                  />
                  <ColorField label="Text color" value={box.color} onChange={(color) => setBox({ color })} />
                </>
              )}
            </div>
          );
        })}
        {(config.textBox.enabled || config.textBox2.enabled) && <OptionalSizeField label="Text size (both)" valuePt={config.captionFontSizePt} onChange={(captionFontSizePt) => onChange({ captionFontSizePt })} />}
      </Group>

      <Group
        id="footer"
        title="Footer"
        summary={config.footer.enabled ? "on" : "off"}
        onReset={() => reset("footer", "footerFontSizePt")}
        extra={<Switch checked={config.footer.enabled} onCheckedChange={(enabled) => onChange({ footer: { ...config.footer, enabled } })} />}
      >
        {!config.footer.enabled ? (
          <p className="text-[10px] text-muted-foreground">Off. Turn on for a footer line with left and right text.</p>
        ) : (
          <>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Left text</span>
              <Input value={config.footer.leftText} onChange={(e) => onChange({ footer: { ...config.footer, leftText: e.target.value } })} className="h-8 text-xs" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Right text</span>
              <Input value={config.footer.rightText} onChange={(e) => onChange({ footer: { ...config.footer, rightText: e.target.value } })} className="h-8 text-xs" />
            </label>
            <ColorField label="Line, text & logo color" value={config.footer.color} onChange={(color) => onChange({ footer: { ...config.footer, color } })} />
            <OptionalSizeField label="Text size" valuePt={config.footerFontSizePt} onChange={(footerFontSizePt) => onChange({ footerFontSizePt })} />
          </>
        )}
      </Group>
    </div>
  );
}

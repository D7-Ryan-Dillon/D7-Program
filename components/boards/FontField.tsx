"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listLocalFontFamilies, localFontAccessSupported, type LocalFontEntry } from "@/lib/boards/localFonts";

/**
 * A font for an export, from the fonts installed on this device. An empty value is the Boards tab's font (`defaultFont`), which is where every export starts.
 * Where the browser cannot list installed fonts, the exact name is typed instead.
 */
export function FontField({ value, onChange, defaultFont }: { value: string; onChange: (font: string) => void; defaultFont: string }) {
  const [fonts, setFonts] = useState<LocalFontEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const supported = localFontAccessSupported();

  const load = async () => {
    setLoading(true);
    try {
      const list = await listLocalFontFamilies();
      setFonts(list);
      if (!list.length) toast.error("No fonts came back: the browser may have denied the permission.");
    } catch {
      toast.error("Couldn't read the fonts on this device. You can type a font name instead.");
    } finally {
      setLoading(false);
    }
  };

  const same = `Same as the Boards tab (${defaultFont})`;
  return (
    <div className="space-y-1">
      {supported ? (
        <div className="flex items-center gap-1.5">
          <Select className="h-7 min-w-0 flex-1 text-[11px]" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Font">
            <option value="">{same}</option>
            {value && !fonts?.some((f) => f.family === value) && <option value={value}>{value}</option>}
            {fonts?.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </Select>
          {!fonts && (
            <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[10px]" disabled={loading} onClick={() => void load()} title="List the fonts installed on this computer">
              {loading ? "Reading…" : "System fonts"}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-7 text-[11px]" placeholder={`${defaultFont} (the Boards tab's font)`} aria-label="Font" />
          {value && (
            <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[10px]" onClick={() => onChange("")}>
              Boards font
            </Button>
          )}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{supported ? "Use “System fonts” to choose from every font installed on this computer." : "This browser can't list installed fonts: type the exact name."}</p>
    </div>
  );
}

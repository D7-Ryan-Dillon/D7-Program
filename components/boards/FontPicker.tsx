"use client";

import { Select } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listLocalFontFamilies, localFontAccessSupported, type LocalFontEntry } from "@/lib/boards/localFonts";

export function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [fonts, setFonts] = useState<LocalFontEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const supported = localFontAccessSupported();

  const loadFonts = async () => {
    setLoading(true);
    try {
      const list = await listLocalFontFamilies();
      setFonts(list);
      if (!list.length) toast.error("No fonts returned -- your browser may have denied the permission.");
    } catch {
      toast.error("Couldn't read installed fonts. You can still type a font name below.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {supported ? (
        fonts ? (
          <Select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value={value}>{value}</option>
            {fonts.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </Select>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={() => void loadFonts()}>
            {loading ? "Reading fonts…" : "Choose from fonts on this device"}
          </Button>
        )
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" placeholder="Exact font name, e.g. Architech Medium" />
      )}
      {!supported && <p className="text-[10px] text-muted-foreground">This browser can&rsquo;t list installed fonts -- type the exact name as it&rsquo;s installed on this device.</p>}
    </div>
  );
}

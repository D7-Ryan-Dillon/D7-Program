"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

// An empty string can't be a Select item value, so it travels as a sentinel.
const EMPTY = "\u0000empty";
const encode = (v: string) => (v === "" ? EMPTY : v);
const decode = (v: string) => (v === EMPTY ? "" : v);

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Reads <option value="x">label</option> children (including ones produced
 * by .map() and fragments), so a native <select> can be swapped for this
 * on-brand one without rewriting its options. */
function readOptions(children: ReactNode, out: Option[] = []): Option[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
    if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({ value: String(child.props.value ?? label), label, disabled: child.props.disabled });
    } else if (child.props.children) {
      readOptions(child.props.children, out);
    }
  });
  return out;
}

/** The app's dropdown: same API shape as a native <select> (value, onChange
 * with `e.target.value`, <option> children) but a dark popup that matches
 * the rest of the UI, instead of the OS's white one. */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  title,
  onClick,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange?: (e: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  "aria-label"?: string;
}) {
  const options = readOptions(children);
  const selected = options.find((o) => o.value === value);

  return (
    <SelectPrimitive.Root value={encode(value)} onValueChange={(v) => v !== null && onChange?.({ target: { value: decode(String(v)) } })} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
        className={cn(
          "flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-2 text-left text-xs text-foreground outline-none transition-colors hover:border-white/25 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:border-magenta/50",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? options[0]?.label ?? ""}</span>
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="h-3 w-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[70]">
          <SelectPrimitive.Popup className="max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border-hair bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={encode(o.value)}
                disabled={o.disabled}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/10"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-3.5 w-3.5 text-magenta" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

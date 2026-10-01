export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/school-logo.png" alt="" width={22} height={22} className="shrink-0 rounded-sm" />
      <span className="font-mono text-[13px] font-medium uppercase tracking-label">
        Erosion <span className="text-muted-foreground">Workspace</span>
      </span>
    </div>
  );
}

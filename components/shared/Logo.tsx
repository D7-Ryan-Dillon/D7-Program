export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
        <rect x="1" y="1" width="20" height="20" rx="5" fill="none" stroke="currentColor" strokeOpacity="0.25" />
        <path
          d="M5 14c2-1 2.5-4 5-4s2 3.5 4.5 3.5S16 10 17 9"
          fill="none"
          stroke="url(#logo-grad)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="22" y2="22">
            <stop offset="0" stopColor="#c43383" />
            <stop offset="1" stopColor="#db7228" />
          </linearGradient>
        </defs>
      </svg>
      <span className="font-mono text-[13px] font-medium uppercase tracking-label">
        Erosion <span className="text-muted-foreground">Workspace</span>
      </span>
    </div>
  );
}

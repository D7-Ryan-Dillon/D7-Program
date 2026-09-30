"use client";

import { Component, type ReactNode } from "react";

/**
 * Suspense catches a loading promise; it does nothing for that promise's
 * rejection. Anything that loads an external asset at render time (an HDR
 * environment map, a font, a remote texture) needs this too, or a single
 * failed fetch -- a flaky connection, a blocked host -- takes down the
 * whole tree with no way to recover short of a full page reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

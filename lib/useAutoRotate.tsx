"use client";

// One auto-rotate for every viewport (Viewer, Analysis, Builder, Arrange). It stops while you touch the model (drag, wheel, touch) and for
// IDLE_MS afterwards, then resumes only if the toggle is still on. The speed comes from the frame time, so "seconds per turn" is true at any refresh rate
// (three's OrbitControls turns a fixed angle per update, which made it twice as fast on a 120 Hz screen).

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/** How long after the last touch before the model starts turning again. */
export const AUTO_ROTATE_IDLE_MS = 2000;

interface Rotatable {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

export function AutoRotateRig({
  controlsRef,
  enabled,
  secs,
  manage = true,
  settledRef,
  idleRef,
}: {
  controlsRef: RefObject<unknown>;
  enabled: boolean;
  /** Seconds per full turn. */
  secs: number;
  /** false when something else (the matched-cameras rig) sets `controls.autoRotate` from `idleRef`. */
  manage?: boolean;
  /** false while a view change is still animating the camera. */
  settledRef?: MutableRefObject<boolean>;
  /** Written every frame: true when the user has not touched the model for a while. */
  idleRef?: MutableRefObject<boolean>;
}) {
  const gl = useThree((s) => s.gl);
  const touching = useRef(false);
  const lastTouch = useRef(-1e9);

  useEffect(() => {
    const el = gl.domElement;
    const down = () => {
      touching.current = true;
      lastTouch.current = performance.now();
    };
    const up = () => {
      touching.current = false;
      lastTouch.current = performance.now();
    };
    const poke = () => {
      lastTouch.current = performance.now();
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("wheel", poke, { passive: true });
    el.addEventListener("touchstart", poke, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("wheel", poke);
      el.removeEventListener("touchstart", poke);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  // before drei's own controls update (priority -1), so this frame's value is the one used
  useFrame((_, delta) => {
    const controls = controlsRef.current as Rotatable | null;
    if (!controls) return;
    const idle = !touching.current && performance.now() - lastTouch.current > AUTO_ROTATE_IDLE_MS;
    if (idleRef) idleRef.current = idle;
    controls.autoRotateSpeed = (3600 * Math.min(delta, 0.1)) / Math.max(secs, 1);
    if (manage) controls.autoRotate = enabled && idle && (settledRef?.current ?? true);
  }, -2);

  return null;
}

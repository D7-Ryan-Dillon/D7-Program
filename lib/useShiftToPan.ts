"use client";

import { useEffect, type ComponentRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls } from "@react-three/drei";

/** Holding Shift while left-dragging pans instead of orbits (OrbitControls'
 * default pan trigger is right-drag, which isn't discoverable and is
 * awkward on a trackpad). Reads `shiftKey` directly off the pointerdown
 * event that starts the drag -- not a separate global keydown/keyup pair --
 * so it's correct regardless of timing or whether Shift was already held
 * before the pointer entered the canvas. A window-level *capture*-phase
 * listener runs before OrbitControls' own pointerdown handler (attached
 * without capture, on the canvas itself), so the mouse-button mapping is
 * already set correctly by the time OrbitControls reads it. */
export function useShiftToPan(controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>) {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const controls = controlsRef.current;
      if (controls) controls.mouseButtons.LEFT = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [controlsRef]);
}

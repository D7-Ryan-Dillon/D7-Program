"use client";

import { useEffect, type MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ViewportHandle } from "@/lib/viewportCapture";

/** Lives inside a <Canvas> and exposes what an offscreen export needs (scene,
 * camera, orbit target, model centre) through `handleRef`. `framing` can name
 * the content's centre/radius when the whole scene box would include things
 * that aren't the model (grids, helpers). */
export function CaptureBridge({ handleRef, framing }: { handleRef: MutableRefObject<ViewportHandle | null>; framing?: () => { center: THREE.Vector3; radius: number } | null }) {
  const get = useThree((s) => s.get);

  useEffect(() => {
    handleRef.current = {
      snapshot() {
        const { scene, camera, size } = get();
        const controls = get().controls as unknown as { target?: THREE.Vector3 } | null;
        if (!(camera instanceof THREE.PerspectiveCamera)) return null;
        let frame = framing?.() ?? null;
        if (!frame) {
          const sphere = new THREE.Sphere();
          new THREE.Box3().setFromObject(scene).getBoundingSphere(sphere);
          frame = Number.isFinite(sphere.radius) && sphere.radius > 0 ? { center: sphere.center, radius: sphere.radius } : { center: new THREE.Vector3(), radius: 5 };
        }
        return {
          scene,
          camera,
          target: controls?.target?.clone() ?? frame.center.clone(),
          center: frame.center.clone(),
          radius: frame.radius,
          aspect: size.width / Math.max(size.height, 1),
        };
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [get, handleRef, framing]);

  return null;
}

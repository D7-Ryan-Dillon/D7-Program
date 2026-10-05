// Asks the analysis worker to read an arrangement. Only the newest request matters: asking again while one is running
// stops the old one (the worker is restarted) so a burst of edits never queues seconds of stale work. Without Worker
// support (or if the worker fails to start) the same function runs on the main thread.

import { computeBundle, type Bundle, type BundleInput } from "./bundle";
import type { WorkerReply } from "./analysis.worker";

let worker: Worker | null = null;
let pending: { id: number; resolve: (b: Bundle) => void; reject: (e: Error) => void } | null = null;
let counter = 0;

function start(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = pending;
      if (!p || p.id !== e.data.id) return;
      pending = null;
      if ("error" in e.data) p.reject(new Error(e.data.error));
      else p.resolve(e.data.bundle);
    };
    w.onerror = (e) => {
      const p = pending;
      pending = null;
      worker = null;
      p?.reject(new Error(e.message || "The analysis worker failed."));
    };
    return w;
  } catch {
    return null;
  }
}

/** Reads the voxels; resolves with null if a newer request replaced this one. */
export async function analyzeArrangement(input: BundleInput): Promise<Bundle | null> {
  const id = ++counter;
  if (pending) {
    // a newer request: drop the running one
    worker?.terminate();
    worker = null;
    pending.resolve(null as unknown as Bundle);
    pending = null;
  }
  worker = worker ?? start();
  if (!worker) {
    await new Promise((r) => setTimeout(r, 0));
    return computeBundle(input);
  }
  const w = worker;
  const result = await new Promise<Bundle | null>((resolve, reject) => {
    pending = { id, resolve: resolve as (b: Bundle) => void, reject };
    w.postMessage({ id, input });
  }).catch(async (err) => {
    // the worker could not run it (bundler or browser limits): do it here
    console.warn("[arrange] analysis worker unavailable, reading on the main thread:", err);
    return computeBundle(input);
  });
  return id === counter ? result : null;
}

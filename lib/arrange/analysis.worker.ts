/// <reference lib="webworker" />
// Reads an arrangement's combined voxels off the page (see lib/arrange/bundle.ts).

import { computeBundle, type Bundle, type BundleInput } from "./bundle";

export interface WorkerRequest {
  id: number;
  input: BundleInput;
}
export type WorkerReply = { id: number; bundle: Bundle } | { id: number; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, input } = e.data;
  try {
    const bundle = computeBundle(input);
    (self as unknown as Worker).postMessage({ id, bundle } satisfies WorkerReply, [bundle.rooms.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies WorkerReply);
  }
};

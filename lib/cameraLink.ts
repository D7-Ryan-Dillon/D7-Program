// "Match cameras": several viewports share one camera. The hub is a plain
// mutable object a multi-viewer keeps in a ref; whichever pane is being
// orbited (or the leader, while auto-rotating) writes its camera into it,
// relative to its own model centre, and the other panes copy it each frame.

export interface LinkHub {
  version: number;
  /** Id of the pane that wrote last. */
  driver: string | null;
  lastActive: number;
  pos: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export const newLinkHub = (): LinkHub => ({ version: 0, driver: null, lastActive: 0, pos: [8, 6, 8], target: [0, 0, 0], up: [0, 1, 0] });

export interface CameraLink {
  id: string;
  hub: LinkHub;
  /** The pane whose auto-rotate drives the others. */
  leader: boolean;
}

// The hub is shared mutable state by design; these helpers do the mutating so
// React components only ever call functions on it.
export function markActive(hub: LinkHub, id: string, now: number) {
  hub.driver = id;
  hub.lastActive = now;
}

export function publish(hub: LinkHub, pos: [number, number, number], target: [number, number, number], up: [number, number, number]): number {
  hub.pos = pos;
  hub.target = target;
  hub.up = up;
  hub.version++;
  return hub.version;
}

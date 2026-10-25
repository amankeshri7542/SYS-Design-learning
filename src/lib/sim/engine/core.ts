// The engine's core: `Sim` with the modules every scene uses. The optional ones (connections, real time, gathering,
// elections, bookings, storage) load on demand through `loadModules`, so a page carries only those its lesson needs;
// `index.ts` loads them all, for tests, scripts and server pages.
import "./control";
import "./clients";
import "./transport";
import "./routing";
import "./cache";
import "./data";
import "./work";
import type { ModuleName } from "./needs";

export { Sim, MODULES } from "./sim";
export { TICK, Win, type Conn, type Done, type Frame, type NodeRt, type Note, type Phase, type Req, type Spawn } from "./model";
export { ownerOf } from "./ring";
export { needsOf, type ModuleName } from "./needs";

const LOADERS: Record<ModuleName, () => Promise<unknown>> = {
  connections: () => import("./connections"),
  realtime: () => import("./realtime"),
  gather: () => import("./gather"),
  elections: () => import("./elections"),
  bookings: () => import("./bookings"),
  storage: () => import("./storage"),
};

/** Every optional module: for a page that may show any lesson (the home page's previews). */
export const ALL_MODULES: readonly ModuleName[] = ["connections", "realtime", "gather", "elections", "bookings", "storage"];

const loading = new Map<string, Promise<void>>();

/** Load the optional modules a page's scenes need, once: a page waits on this before it runs a scene. */
export function loadModules(names: readonly ModuleName[]): Promise<void> {
  const key = [...names].sort().join(",");
  let p = loading.get(key);
  if (!p) loading.set(key, (p = Promise.all(names.map((n) => LOADERS[n]())).then(() => undefined)));
  return p;
}

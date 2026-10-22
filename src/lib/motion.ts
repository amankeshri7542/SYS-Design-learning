// Motion tokens for code. globals.css carries the same values as --dur-* and --ease-*.

/** Durations in ms: hover and press, entering, leaving, a world changing shape, and the ceiling for a scene intro. */
export const DUR = { fast: 120, base: 240, exit: 160, switch: 480, hero: 900 } as const;

/** Ease-out for things entering or settling (the canvas rings today). */
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
/** Close to cubic-bezier(0.22, 1, 0.36, 1), the CSS --ease-out. */
export const easeOutQuint = (u: number) => 1 - Math.pow(1 - u, 5);
/** For things leaving. */
export const easeIn = (u: number) => u * u * u;

/** Frame-rate independent smoothing: move `prev` toward `target` over `dt` ms with time constant `tau` ms. */
export const smooth = (prev: number, target: number, dt: number, tau: number) => prev + (target - prev) * (1 - Math.exp(-dt / tau));

/** Smoothing time constants in ms. */
export const TAU = { queue: 110, flow: 160, pressure: 110 } as const;

/** Scene intro timing in ms: the stagger between parts, one part's entrance, and a link's stroke draw. */
export const INTRO = { step: 60, node: 360, stroke: 420 } as const;

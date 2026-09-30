/** Shared single-probe policy. Callers must reserve one in-flight half-open probe. */
export type CircuitState = {
  phase: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number;
};
export const createCircuitState = (): CircuitState => ({
  phase: "closed",
  failures: 0,
  openedAt: -1,
});
export function allowCircuitCall(
  state: CircuitState,
  time: number,
  cooldown: number,
): boolean {
  if (state.phase === "open" && time - state.openedAt >= cooldown)
    state.phase = "half-open";
  return state.phase !== "open";
}
export function recordCircuitResult(
  state: CircuitState,
  time: number,
  threshold: number,
  success: boolean,
): void {
  if (success) {
    state.phase = "closed";
    state.failures = 0;
    return;
  }
  state.failures++;
  if (state.phase === "half-open" || state.failures >= threshold) {
    state.phase = "open";
    state.openedAt = time;
  }
}

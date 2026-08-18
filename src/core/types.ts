/**
 * Shared vocabulary between every effect in the pack.
 */

export interface EffectHandle {
  /** Removes listeners, releases resources, detaches injected DOM. Idempotent. */
  destroy(): void;
}

/** Every effect returns this, widened with its own option type. */
export interface Effect<Options> extends EffectHandle {
  /** Merges a partial patch over the current options and re-renders. */
  setOptions(patch: Partial<Options>): void;
}

/** A step failed in a way retrying can fix (network error, 5xx, rate limit…). */
export class RetryableStepError extends Error {}

/** A step failed and retrying won't help (invalid value, record not found, 4xx…). */
export class PermanentStepError extends Error {}

/** A DELAY step: the run pauses and continues after `ms`. */
export class WaitSignal extends Error {
  constructor(readonly ms: number) {
    super(`Waiting ${ms}ms`);
  }
}

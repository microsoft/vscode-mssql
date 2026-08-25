/**
 * CLI exit-code contract (design §26). These are part of the public contract:
 * CI gates key off them, so never repurpose a code.
 */
export const ExitCode = {
    /** Run completed, no gated regression. */
    ok: 0,
    /** Gated regression found. */
    regression: 1,
    /** Config or schema validation failed. */
    configInvalid: 2,
    /** Environment preflight failed. */
    preflightFailed: 3,
    /** Scenario failed. */
    scenarioFailed: 4,
    /** Infrastructure or collector failure. */
    infrastructureFailure: 5,
    /** Insufficient valid samples. */
    insufficientSamples: 6,
    /**
     * Central-store publish/admin failure (perftest push, perftest central).
     * Deliberately distinct from infrastructureFailure: a central outage must
     * never be mistaken for a gate-relevant failure (central design 8.2).
     */
    pushFailed: 7,
} as const;

export type ExitCodeName = keyof typeof ExitCode;
export type ExitCodeValue = (typeof ExitCode)[ExitCodeName];

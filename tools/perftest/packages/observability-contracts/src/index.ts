/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @mssqlperf/observability-contracts — the Shared Observability Contract.
 *
 * One governed vocabulary for markers, spans, events, and metrics across
 * vscode-mssql, perftest, and (namespaced) STS. Consumers:
 *  - perftest: normalizer eligibility, scenario conformance tests
 *  - vscode-mssql: vendored generated snapshot + conformance tests
 *  - docs: generated EVENTS.md
 *
 * The registry does not force one physical record shape — markers,
 * DiagEvents, and STS spans stay structurally different. It defines the
 * SEMANTIC truth: what each name means, who may emit it, how it pairs, what
 * its fields are classified as, which timing plane applies, and whether it
 * may ever feed a measurement.
 */

import eventTypesJson from "./registry/event-types.json";
import classificationsJson from "./registry/classifications.json";
import timingClassesJson from "./registry/timing-classes.json";

export type TimingClass = "sameProcessMonotonic" | "epochAligned" | "derived";
export type EventKind = "marker" | "webviewMark" | "event" | "metric" | "richMetric" | "spanFamily";
export type MarkerPhase = "begin" | "end" | "instant";

export interface EventTypeEntry {
    /** Exact canonical name (exclusive with prefix). */
    name?: string;
    /** Prefix for dynamically-named families (exclusive with name). */
    prefix?: string;
    kind: EventKind;
    phase?: MarkerPhase;
    /** Explicit pairing — suffix conventions vary and are never guessed. */
    pairsWith?: string;
    feature: string;
    processRoles: string[];
    timingClass: TimingClass;
    /** May a duration derived from this event ever be measurement-eligible? */
    measurementEligible: boolean;
    /** attr name -> classification id (see classifications.json). */
    attrs: Record<string, string>;
    /** Honesty flag: the attr list is known-partial while the registry matures. */
    attrsComplete: boolean;
    notes?: string;
    deprecated?: boolean;
}

export interface MetricNameEntry {
    name: string;
    feature: string;
    derivedFrom: string[];
}

export interface Registry {
    schemaVersion: string;
    events: EventTypeEntry[];
    metrics: MetricNameEntry[];
    classifications: Record<string, { examples: string[]; defaultBehavior: string }>;
    timingClasses: Record<string, { meaning: string; rendering: string; eligibility: string }>;
}

export function loadRegistry(): Registry {
    const events = eventTypesJson as unknown as {
        schemaVersion: string;
        events: EventTypeEntry[];
        metrics: MetricNameEntry[];
    };
    return {
        schemaVersion: events.schemaVersion,
        events: events.events,
        metrics: events.metrics,
        classifications: (
            classificationsJson as unknown as { classifications: Registry["classifications"] }
        ).classifications,
        timingClasses: (
            timingClassesJson as unknown as { timingClasses: Registry["timingClasses"] }
        ).timingClasses,
    };
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

export interface NameMatch {
    known: boolean;
    matchedBy?: "exact" | "prefix";
    entry?: EventTypeEntry;
}

/**
 * Resolve an emitted event/marker name against the registry. Span-family
 * members may carry `.begin`/`.end` phase suffixes (rpc.x/y.begin) — the
 * family prefix match covers them.
 */
export function explainEventName(name: string, registry?: Registry): NameMatch {
    const reg = registry ?? loadRegistry();
    const exact = reg.events.find((e) => e.name === name);
    if (exact) {
        return { known: true, matchedBy: "exact", entry: exact };
    }
    let best: EventTypeEntry | undefined;
    for (const entry of reg.events) {
        if (entry.prefix && name.startsWith(entry.prefix)) {
            if (!best || entry.prefix.length > (best.prefix?.length ?? 0)) {
                best = entry;
            }
        }
    }
    if (best) {
        return { known: true, matchedBy: "prefix", entry: best };
    }
    return { known: false };
}

export function isKnownMetricName(name: string, registry?: Registry): boolean {
    const reg = registry ?? loadRegistry();
    return reg.metrics.some((m) => m.name === name);
}

// ---------------------------------------------------------------------------
// Metric eligibility — the decision object that replaces overloaded
// `official`. Carried with every metric; rendered wherever the number is.
// ---------------------------------------------------------------------------

export type MetricEnvironment = "controlledHarness" | "interactiveHost" | "unknown";
export type TimePlane = "monotonic" | "epoch" | "calibrated" | "derived";
export type EligibilityPassType = "measurement" | "diagnostic" | "calibration";

export interface MetricEligibility {
    /** Derived from approved marker/product-timer sources under timing rules. */
    measurementEligible: boolean;
    /** Measurement-eligible AND produced in a controlled harness environment. */
    ciGatingEligible: boolean;
    /** Measurement-eligible but from an interactive host (self-test): useful, never a gate. */
    exploratory: boolean;
    /** Not measurement-eligible: collectors, epoch alignment, rich collection, diagnostic pass. */
    diagnosticOnly: boolean;
    timePlane: TimePlane;
    source: string;
    passType: EligibilityPassType;
    environment: MetricEnvironment;
    /** Machine-assembled explanation of the deciding factors. */
    reason: string;
}

export interface EligibilityInput {
    /** Metric source id (perftest MetricSource or equivalent). */
    source: string;
    passType: EligibilityPassType;
    environment: MetricEnvironment;
    timePlane: TimePlane;
    repStatus: "passed" | "failed" | "invalid" | "aborted";
    /** Rich collection active during the rep ⇒ diagnostic-only, always. */
    richCollection: boolean;
    /** Produced by a diagnostic collector ⇒ diagnostic-only, always. */
    fromCollector?: boolean;
    /**
     * Derived metrics (source "derived") are measurement-capable ONLY when a
     * derivation block declares formula + inputs (peer-review rule: derived
     * inherits the weakest input plane and requires provenance).
     */
    hasDerivation?: boolean;
    /** Eligibility already computed for every declared derivation input. */
    inputs?: Array<
        Pick<
            MetricEligibility,
            "measurementEligible" | "ciGatingEligible" | "diagnosticOnly" | "timePlane" | "reason"
        >
    >;
}

const MEASUREMENT_SOURCES = new Set(["marker", "productTimer", "manual"]);

/**
 * The single shared eligibility decision. perftest's normalizer and the
 * in-proc self-test both call this so the rules cannot drift.
 *
 * Honesty rules (design §12.2 + peer-review terminology split):
 *  - only marker/product-timer sources and orchestrator-clock `manual` timings
 *    can be measurement-eligible;
 *  - epoch-aligned durations are diagnostic-only ("calibrated" is reserved
 *    for the harness's clock-calibrated cross-process plane);
 *  - diagnostic/calibration passes never produce measurement metrics;
 *  - rich collection or collector provenance forces diagnostic-only;
 *  - only passed reps measure anything;
 *  - CI gating additionally requires the controlled harness environment;
 *  - an interactive host yields exploratory, never gating.
 */
export function deriveEligibility(input: EligibilityInput): MetricEligibility {
    const reasons: string[] = [];
    let measurement = true;
    let effectiveTimePlane = input.timePlane;

    const derivedWithProvenance = input.source === "derived" && input.hasDerivation === true;
    if (!MEASUREMENT_SOURCES.has(input.source) && !derivedWithProvenance) {
        measurement = false;
        reasons.push(
            input.source === "derived"
                ? "derived metric without a derivation block"
                : `source '${input.source}' is diagnostic`,
        );
    }
    if (derivedWithProvenance) {
        if (!input.inputs || input.inputs.length === 0) {
            measurement = false;
            reasons.push("derived metric has no resolved input eligibility");
        } else {
            const weakest = [...input.inputs].sort(
                (a, b) => timePlaneRank(b.timePlane) - timePlaneRank(a.timePlane),
            )[0]!;
            effectiveTimePlane = weakest.timePlane;
            const ineligible = input.inputs.filter((candidate) => !candidate.measurementEligible);
            if (ineligible.length > 0) {
                measurement = false;
                reasons.push(`derived input is diagnostic-only (${ineligible[0]!.reason})`);
            }
        }
    }
    if (effectiveTimePlane === "epoch") {
        measurement = false;
        reasons.push("epoch-aligned timing is diagnostic-only");
    }
    if (input.passType !== "measurement") {
        measurement = false;
        reasons.push(`${input.passType} pass`);
    }
    if (input.repStatus !== "passed") {
        measurement = false;
        reasons.push(`rep ${input.repStatus}`);
    }
    if (input.richCollection) {
        measurement = false;
        reasons.push("rich collection was active");
    }
    if (input.fromCollector) {
        measurement = false;
        reasons.push("collector-produced");
    }

    if (measurement) {
        reasons.push(
            effectiveTimePlane === "monotonic"
                ? `same-process monotonic from source '${input.source}'`
                : `${effectiveTimePlane} plane from source '${input.source}'`,
        );
    }

    const ciGating =
        measurement &&
        input.environment === "controlledHarness" &&
        (!derivedWithProvenance || input.inputs!.every((candidate) => candidate.ciGatingEligible));
    const exploratory = measurement && input.environment === "interactiveHost";
    if (measurement && !ciGating) {
        reasons.push(
            input.environment === "interactiveHost"
                ? "interactive host — exploratory, never a gate"
                : "environment unknown — not gate-eligible",
        );
    }

    return {
        measurementEligible: measurement,
        ciGatingEligible: ciGating,
        exploratory,
        diagnosticOnly: !measurement,
        timePlane: effectiveTimePlane,
        source: input.source,
        passType: input.passType,
        environment: input.environment,
        reason: reasons.join("; "),
    };
}

function timePlaneRank(timePlane: TimePlane): number {
    return { monotonic: 0, calibrated: 1, derived: 2, epoch: 3 }[timePlane];
}

// ---------------------------------------------------------------------------
// Trace Identity V1 — the cross-repo correlation contract. Identities can be
// partial, but partial must be VISIBLE: the linter below reports fog instead
// of letting views draw invented roads.
// ---------------------------------------------------------------------------

/**
 * The identity fields a fully-stitched event may carry. Every field is
 * optional — the contract is about MEANING and propagation, not presence.
 */
export interface TraceIdentityV1 {
    /** perftest / self-test run id (absent for plain product sessions). */
    runId?: string;
    repId?: number;
    scenarioId?: string;
    /** Root user action / scenario action. Closes on TTL or explicit end. */
    rootActionId?: string;
    /** Cross-process trace id (the console's trace grouping key). */
    traceId?: string;
    spanId?: string;
    /** JSON-RPC id crossing extension → STS. A correlation HINT, reused per connection — never globally unique. */
    jsonRpcId?: string;
    /** Request id crossing the webview boundary. */
    webviewRpcId?: string;
    /** Stable safe grouping digests — never raw identifiers. */
    ownerUriDigest?: string;
    connectionIdDigest?: string;
    /** STS2 envelope identities (imported): corr maps here, cause is an EDGE in the cause graph, never a fake span parent. */
    sts2Corr?: string;
    sts2CauseSeq?: number;
}

/** Root actions that stay open longer than this are leaks, not traces. */
export const ROOT_ACTION_TTL_MS = 120_000;

/** Structural event shape the linter needs (DiagEvent satisfies it). */
export interface CorrelationEvent {
    seq: number;
    type: string;
    kind: string;
    epochMs: number;
    process: string;
    traceId?: string;
    durationMs?: number;
    tags?: string[];
}

export interface UnmatchedPair {
    /** Pair or family label, e.g. "mssql.connection.begin↔ready" or "rpc.<method>". */
    name: string;
    begins: number;
    ends: number;
}

export interface CorrelationLintReport {
    totalEvents: number;
    /** mssql.* markers with no trace correlation (excluding lifecycle noise). */
    orphanCount: number;
    orphanRatio: number;
    /** Registry pairs and .begin/.end span families with unequal sides. */
    unmatchedPairs: UnmatchedPair[];
    /** Traces spanning longer than ROOT_ACTION_TTL_MS (leaked roots). */
    longLivedRoots: Array<{ traceId: string; durationMs: number; eventCount: number }>;
    /** Epoch-aligned (cross-process diagnostic) events — rendered hatched, never official. */
    epochAlignedCount: number;
    /** Events before scenario.start or after scenario.end when both exist. */
    outsideScenarioWindow: number;
    /** good = stitched; fair = usable with fog; poor = correlation unreliable. */
    score: "good" | "fair" | "poor";
    /** Human-readable explanations — the "why this looks like this" text. */
    notes: string[];
}

/** Event types that legitimately carry no trace correlation. */
const CORRELATION_EXEMPT =
    /^(sessionDiag\.|system\.|selfTest\.|scenario\.|import\.|mssql\.sts\.pid|mssql\.activate)/;

/**
 * Registry-driven correlation lint. Marker pairing comes from the REGISTRY's
 * explicit pairsWith (begin/ready, submit/complete — never suffix guessing);
 * dynamic span families pair on .begin/.end name suffixes.
 */
export function lintCorrelation(
    events: CorrelationEvent[],
    registry?: Registry,
): CorrelationLintReport {
    const reg = registry ?? loadRegistry();
    const notes: string[] = [];

    // --- orphans ---------------------------------------------------------
    let correlatable = 0;
    let orphans = 0;
    for (const event of events) {
        if (!explainEventName(event.type, reg).known || CORRELATION_EXEMPT.test(event.type)) {
            continue;
        }
        correlatable++;
        if (!event.traceId) {
            orphans++;
        }
    }
    const orphanRatio = correlatable > 0 ? orphans / correlatable : 0;
    if (orphans > 0) {
        notes.push(
            `${orphans} product marker(s) have no trace correlation — they appear in the Consolidated Trace but join no waterfall`,
        );
    }

    // --- pairs (registry-explicit) ----------------------------------------
    const counts = new Map<string, number>();
    for (const event of events) {
        counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
    const unmatchedPairs: UnmatchedPair[] = [];
    const seenPairs = new Set<string>();
    for (const entry of reg.events) {
        if (!entry.name || !entry.pairsWith || entry.phase !== "begin") {
            continue;
        }
        const pairKey = `${entry.name}|${entry.pairsWith}`;
        if (seenPairs.has(pairKey)) {
            continue;
        }
        seenPairs.add(pairKey);
        const begins = counts.get(entry.name) ?? 0;
        const ends = counts.get(entry.pairsWith) ?? 0;
        if (begins !== ends && (begins > 0 || ends > 0)) {
            unmatchedPairs.push({
                name: `${entry.name} ↔ ${entry.pairsWith}`,
                begins,
                ends,
            });
        }
    }
    // Dynamic span families come from the registry and pair on .begin/.end.
    const spanFamilies = reg.events.filter(
        (entry): entry is EventTypeEntry & { prefix: string } =>
            entry.kind === "spanFamily" && typeof entry.prefix === "string",
    );
    const familyBase = new Map<string, { begins: number; ends: number }>();
    for (const [type, count] of counts) {
        if (!spanFamilies.some((entry) => type.startsWith(entry.prefix))) {
            continue;
        }
        if (type.endsWith(".begin")) {
            const base = type.slice(0, -".begin".length);
            const row = familyBase.get(base) ?? { begins: 0, ends: 0 };
            row.begins += count;
            familyBase.set(base, row);
        } else if (type.endsWith(".end")) {
            const base = type.slice(0, -".end".length);
            const row = familyBase.get(base) ?? { begins: 0, ends: 0 };
            row.ends += count;
            familyBase.set(base, row);
        }
    }
    for (const [base, row] of familyBase) {
        if (row.begins !== row.ends) {
            unmatchedPairs.push({ name: base, begins: row.begins, ends: row.ends });
        }
    }
    if (unmatchedPairs.length > 0) {
        notes.push(
            `${unmatchedPairs.length} begin/end pair(s) are unbalanced — durations for those operations are absent or partial, never fabricated`,
        );
    }

    // --- long-lived roots --------------------------------------------------
    const traceExtent = new Map<string, { min: number; max: number; count: number }>();
    for (const event of events) {
        if (!event.traceId) {
            continue;
        }
        const extent = traceExtent.get(event.traceId) ?? {
            min: event.epochMs,
            max: event.epochMs,
            count: 0,
        };
        extent.min = Math.min(extent.min, event.epochMs);
        extent.max = Math.max(extent.max, event.epochMs + (event.durationMs ?? 0));
        extent.count++;
        traceExtent.set(event.traceId, extent);
    }
    const longLivedRoots = [...traceExtent.entries()]
        .filter(([, extent]) => extent.max - extent.min > ROOT_ACTION_TTL_MS)
        .map(([traceId, extent]) => ({
            traceId,
            durationMs: extent.max - extent.min,
            eventCount: extent.count,
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 10);
    if (longLivedRoots.length > 0) {
        notes.push(
            `${longLivedRoots.length} trace(s) exceed the ${ROOT_ACTION_TTL_MS / 1000}s root-action TTL — later events may be joining a leaked root, widening waterfalls`,
        );
    }

    // --- epoch-aligned + scenario window ------------------------------------
    let epochAlignedCount = 0;
    for (const event of events) {
        if (
            explainEventName(event.type, reg).entry?.timingClass === "epochAligned" ||
            event.tags?.includes("stsDiag")
        ) {
            epochAlignedCount++;
        }
    }
    if (epochAlignedCount > 0) {
        notes.push(
            `${epochAlignedCount} event(s) are epoch-aligned cross-process diagnostics — hatched bars, never official timing`,
        );
    }
    let outsideScenarioWindow = 0;
    const start = events.find((e) => e.type === "scenario.start");
    const end = events.find((e) => e.type === "scenario.end");
    if (start && end) {
        for (const event of events) {
            if (event.epochMs < start.epochMs || event.epochMs > end.epochMs) {
                outsideScenarioWindow++;
            }
        }
        if (outsideScenarioWindow > 0) {
            notes.push(
                `${outsideScenarioWindow} event(s) fall outside the scenario window — setup/teardown noise, excluded from scenario metrics`,
            );
        }
    }

    // --- score --------------------------------------------------------------
    const poor = orphanRatio > 0.5 || unmatchedPairs.length > 5;
    const fair =
        !poor && (orphanRatio > 0.1 || unmatchedPairs.length > 0 || longLivedRoots.length > 0);
    return {
        totalEvents: events.length,
        orphanCount: orphans,
        orphanRatio: Number(orphanRatio.toFixed(3)),
        unmatchedPairs,
        longLivedRoots,
        epochAlignedCount,
        outsideScenarioWindow,
        score: poor ? "poor" : fair ? "fair" : "good",
        notes,
    };
}

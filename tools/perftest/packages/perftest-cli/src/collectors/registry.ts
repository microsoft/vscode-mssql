/**
 * Collector registry. Collectors register here as they are implemented;
 * `collectors list` reports exactly what exists (design §14.3 catalog is the
 * roadmap, not a claim).
 */

import type { Collector } from "./types";
import { ProcessSamplerCollector } from "./processSampler";

const registry = new Map<string, Collector>();

export function registerCollector(collector: Collector): void {
    registry.set(collector.name, collector);
}

export function listCollectors(): Collector[] {
    return [...registry.values()];
}

export function getCollector(name: string): Collector | undefined {
    return registry.get(name);
}

// Listing-only prototypes; the pipeline creates fresh instances per rep.
registerCollector(new ProcessSamplerCollector());

/** Planned collectors from the design §14.3 catalog, for honest listing. */
export const PLANNED_COLLECTORS: Array<{ name: string; milestone: string }> = [
    { name: "markers", milestone: "M1" },
    { name: "sqlServerXEvents", milestone: "M4-rest" },
    { name: "stsEnvelopeJournal", milestone: "M3" },
    { name: "dotnetCounters", milestone: "M3/M5" },
    { name: "otelMinimal", milestone: "M3" },
    { name: "cdpExtHostProfile", milestone: "M5" },
    { name: "cdpRendererTrace", milestone: "M5" },
    { name: "cdpRendererProfile", milestone: "query-perf" },
    { name: "dotnetTrace", milestone: "M5" },
    { name: "wprEtw", milestone: "M5" },
    { name: "vscodeDiag", milestone: "M5" },
];

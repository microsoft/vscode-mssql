/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

let observer: PerformanceObserver | undefined;
let longTaskCount = 0;
let longTaskTotalMs = 0;
let longestTaskMs = 0;

function ensureObserver(): void {
    if (
        observer ||
        typeof PerformanceObserver === "undefined" ||
        !PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
        return;
    }
    try {
        observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTaskCount++;
                longTaskTotalMs += entry.duration;
                longestTaskMs = Math.max(longestTaskMs, entry.duration);
            }
        });
        observer.observe({ type: "longtask", buffered: true });
    } catch {
        observer = undefined;
    }
}

export function resetQueryStudioWebviewHealth(): void {
    ensureObserver();
    longTaskCount = 0;
    longTaskTotalMs = 0;
    longestTaskMs = 0;
}

/** Privacy-safe renderer resource snapshot; no text or identifiers. */
export function queryStudioWebviewHealthAttrs(
    checkpoint: "terminalPaint" | "interactionPaint" | "tabPaint",
    mountedTabs: number,
): Record<string, string | number | boolean | null> {
    ensureObserver();
    const memory = (
        performance as Performance & {
            memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
        }
    ).memory;
    return {
        checkpoint,
        longTaskCount,
        longTaskTotalMs: Math.round(longTaskTotalMs * 100) / 100,
        longestTaskMs: Math.round(longestTaskMs * 100) / 100,
        gridInstances: document.querySelectorAll("[data-fluent-result-grid='true']").length,
        mountedTabs,
        domNodes: document.getElementsByTagName("*").length,
        ...(memory
            ? {
                  usedJsHeapBytes: memory.usedJSHeapSize,
                  totalJsHeapBytes: memory.totalJSHeapSize,
                  jsHeapLimitBytes: memory.jsHeapSizeLimit,
              }
            : {}),
    };
}

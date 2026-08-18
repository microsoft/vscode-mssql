/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type {
    LanguageServiceStats,
    LanguageServiceStatsProvider,
    StatsHistory,
} from "./contracts.js";

/** How many samples each trend retains. One screen of sparkline, not a time-series database. */
const historyCapacity = 24;

interface Window {
    readonly samples: number[];
    observed: number;
}

/**
 * Holds the published statistics for each open document, and the rolling windows behind them.
 *
 * History lives here rather than in a view because every view would otherwise have to accumulate
 * its own, and a panel that is opened after the interesting edit would start empty — which is
 * exactly when someone opens it.
 */
export class LanguageServiceStatsStore implements LanguageServiceStatsProvider {
    private readonly _stats = new Map<string, LanguageServiceStats>();
    private readonly _windows = new Map<string, Map<string, Window>>();
    private readonly _listeners = new Set<(uri: string) => void>();

    public getStats(uri: string): LanguageServiceStats | undefined {
        return this._stats.get(uri);
    }

    /**
     * Publishes one document's statistics.
     *
     * The caller supplies the current measurements; the store appends them to the rolling windows
     * and hands back the history each trend renders from, so a caller cannot forget to.
     */
    public publish(stats: LanguageServiceStats): void {
        const uri = stats.document.uri;
        const windows = this._windows.get(uri) ?? new Map<string, Window>();
        this._windows.set(uri, windows);
        const withHistory: LanguageServiceStats = {
            ...stats,
            syntax: {
                ...stats.syntax,
                history: this.record(windows, "syntax", stats.syntax.elapsedMs, "ms"),
            },
            semantics: {
                ...stats.semantics,
                history: this.record(windows, "semantics", stats.semantics.elapsedMs, "ms"),
            },
            metadata: {
                ...stats.metadata,
                history: this.record(windows, "metadata", stats.metadata.lastRefreshMs ?? 0, "ms"),
            },
        };
        this._stats.set(uri, Object.freeze(withHistory));
        for (const listener of this._listeners) listener(uri);
    }

    public remove(uri: string): void {
        this._windows.delete(uri);
        if (!this._stats.delete(uri)) return;
        for (const listener of this._listeners) listener(uri);
    }

    public onDidChangeStats(listener: (uri: string) => void): Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }

    private record(
        windows: Map<string, Window>,
        key: string,
        value: number,
        unit: StatsHistory["unit"],
    ): StatsHistory {
        const window = windows.get(key) ?? { samples: [], observed: 0 };
        windows.set(key, window);
        window.samples.push(value);
        window.observed++;
        if (window.samples.length > historyCapacity) window.samples.shift();
        return Object.freeze({
            samples: Object.freeze([...window.samples]),
            unit,
            capacity: historyCapacity,
            observed: window.observed,
        });
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type { LanguageServiceStats, LanguageServiceStatsProvider } from "./contracts.js";

export class LanguageServiceStatsStore implements LanguageServiceStatsProvider {
    private readonly _stats = new Map<string, LanguageServiceStats>();
    private readonly _listeners = new Set<(uri: string) => void>();

    public getStats(uri: string): LanguageServiceStats | undefined {
        return this._stats.get(uri);
    }

    public publish(stats: LanguageServiceStats): void {
        this._stats.set(stats.document.uri, Object.freeze(stats));
        for (const listener of this._listeners) listener(stats.document.uri);
    }

    public remove(uri: string): void {
        if (!this._stats.delete(uri)) return;
        for (const listener of this._listeners) listener(uri);
    }

    public onDidChangeStats(listener: (uri: string) => void): Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }
}

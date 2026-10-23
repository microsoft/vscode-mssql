/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Live QueryTuning override channel (QO-1): the session-scoped singleton a
 * debug surface (Debug Console tuning page — next round) or an experiment
 * writes to. Overrides here sit ABOVE settings/profile and BELOW explicit
 * per-run overrides in the resolver's precedence. Mirrors the completions
 * debug store's override semantics (null/absent = defer) without carrying an
 * event ring — run records already live in qsRunCaptureStore.
 */

import * as vscode from "vscode";
import {
    QueryTuningOverrides,
    normalizeQueryTuningOverrides,
} from "../../sharedInterfaces/queryTuning";

export class QueryTuningOverrideStore {
    private _overrides: QueryTuningOverrides = {};
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    public getOverrides(): QueryTuningOverrides {
        return { ...this._overrides };
    }

    /** Merge a partial update; unknown keys/invalid values are dropped, null = defer. */
    public updateOverrides(partial: unknown): void {
        this._overrides = {
            ...this._overrides,
            ...normalizeQueryTuningOverrides(partial),
        };
        this._onDidChange.fire();
    }

    public replaceOverrides(overrides: unknown): void {
        this._overrides = normalizeQueryTuningOverrides(overrides);
        this._onDidChange.fire();
    }

    public reset(): void {
        this._overrides = {};
        this._onDidChange.fire();
    }
}

/** Singleton — the one live override channel for the extension host. */
export const queryTuningOverrideStore = new QueryTuningOverrideStore();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export interface OpenExecutionPlanSource {
    id: number;
    sourceName: string;
    contents: string;
}

class ExecutionPlanSourceRegistry {
    private readonly _sources = new Map<number, OpenExecutionPlanSource>();
    private _nextId = 1;

    public register(sourceName: string, contents: string): vscode.Disposable {
        const source: OpenExecutionPlanSource = {
            id: this._nextId++,
            sourceName,
            contents,
        };
        this._sources.set(source.id, source);
        return {
            dispose: () => this._sources.delete(source.id),
        };
    }

    public getSources(): readonly OpenExecutionPlanSource[] {
        return [...this._sources.values()];
    }
}

export const executionPlanSourceRegistry = new ExecutionPlanSourceRegistry();

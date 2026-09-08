/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ClaimStore, SessionClaim } from "sql-feature/diagnostics/profiler";

const STORAGE_KEY = "mssql.profiler.sessionClaims";

/**
 * Persists profiler session claims in workspace state.
 *
 * This is what makes orphan cleanup possible: a CREATE EVENT SESSION leaves a durable object on
 * the server, so if the extension host dies before cleanup the only record that the session was
 * ours is the one written here.
 */
export class WorkspaceClaimStore implements ClaimStore {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    async read(): Promise<readonly SessionClaim[]> {
        const stored = this._context.workspaceState.get<SessionClaim[]>(STORAGE_KEY);
        return Array.isArray(stored) ? stored : [];
    }

    async write(claims: readonly SessionClaim[]): Promise<void> {
        await this._context.workspaceState.update(STORAGE_KEY, [...claims]);
    }
}

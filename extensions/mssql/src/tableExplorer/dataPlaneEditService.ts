/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Table Explorer's editing back end, running on the SQL data plane.
 *
 * This is the replacement for the `edit/*` calls into the C# EditData service. That path
 * committed each row as its own statement with no transaction, matched rows on key columns only
 * so a concurrent change was overwritten silently, and could only page by offset because the
 * session kept the whole result set materialised. None of those constraints exist here.
 *
 * The engine itself lives in the `sql-edit` package and knows nothing about VS Code, so all of
 * its rules are unit tested without a server. This file is only the seam between it and the
 * extension host.
 */

import * as vscode from "vscode";

import {
    ColumnFilter,
    EditPage,
    EditSession,
    EditSessionInfo,
    PageCursor,
    SortColumn,
    StagedEdit,
    SqlEditError,
} from "sql-feature/edit";

import { DataPlaneRunner } from "../sqlDiagnostics/dataPlaneRunner";
import { ISqlSession } from "../services/sqlDataPlane/api";

/** Which engine the Table Explorer uses. */
export type TableEditEngine = "sts1" | "dataPlane";

/** Reads the engine setting. The old path stays the default until this one has proven itself. */
export function configuredEditEngine(): TableEditEngine {
    const configured = vscode.workspace
        .getConfiguration("mssql.tableExplorer")
        .get<string>("engine");
    return configured === "dataPlane" ? "dataPlane" : "sts1";
}

export interface OpenTableRequest {
    readonly schema: string;
    readonly name: string;
}

export interface ReadPageRequest {
    readonly pageSize: number;
    readonly filters?: readonly ColumnFilter[];
    readonly sort?: readonly SortColumn[];
    readonly cursor?: PageCursor;
}

/**
 * One editable table, for the lifetime of a panel.
 *
 * Sessions are keyed by the panel rather than by a server-side handle: there is no state on the
 * server to keep alive, so nothing leaks if a panel is closed abruptly.
 */
export class DataPlaneEditService implements vscode.Disposable {
    private readonly _sessions = new Map<string, EditSession>();

    constructor(private readonly _session: ISqlSession) {}

    private get runner(): DataPlaneRunner {
        return new DataPlaneRunner(this._session);
    }

    /** Opens a table and reports how its rows will be identified. */
    async open(key: string, request: OpenTableRequest): Promise<EditSessionInfo> {
        const session = await EditSession.open(this.runner, request.schema, request.name);
        this._sessions.set(key, session);
        return session.info;
    }

    async readPage(key: string, request: ReadPageRequest): Promise<EditPage> {
        return this.require(key).readPage({
            pageSize: request.pageSize,
            ...(request.filters ? { filters: request.filters } : {}),
            ...(request.sort ? { sort: request.sort } : {}),
            ...(request.cursor ? { cursor: request.cursor } : {}),
        });
    }

    async countRows(key: string, filters?: readonly ColumnFilter[]): Promise<number> {
        return this.require(key).countRows({ ...(filters ? { filters } : {}) });
    }

    /** The script the preview pane shows. Identical to what `commit` runs. */
    script(key: string, edits: readonly StagedEdit[]): string {
        return this.require(key).script(edits);
    }

    /**
     * Saves every staged edit, or none of them.
     *
     * A concurrency failure comes back naming the row, so the grid can point at it rather than
     * showing a server error with no context.
     */
    async commit(key: string, edits: readonly StagedEdit[]): Promise<number> {
        const result = await this.require(key).commit(edits);
        return result.applied;
    }

    close(key: string): void {
        this._sessions.delete(key);
    }

    dispose(): void {
        this._sessions.clear();
    }

    private require(key: string): EditSession {
        const session = this._sessions.get(key);
        if (!session) {
            throw new SqlEditError(
                "This table is no longer open for editing. Reopen it and try again.",
                "notEditable",
            );
        }
        return session;
    }
}

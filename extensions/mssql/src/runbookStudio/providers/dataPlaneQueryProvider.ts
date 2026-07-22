/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Small STS v2/SQL Data Plane query seam for bounded Runbook providers. */

import { PreparedConnection } from "../../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";
import { DataPlaneQueryCoreError, runDataPlaneQueryCore } from "./dataPlaneQueryCore";

export interface RunbookDataPlaneQueryRequest {
    prepared: PreparedConnection;
    database: string;
    applicationName: string;
    sql: string;
    tag: string;
    isCancellationRequested: () => boolean;
    maxRows?: number;
    timeoutMs?: number;
}

export class RunbookDataPlaneQueryError extends Error {
    constructor(
        message: string,
        public readonly code: "cancelled" | "queryFailed" | "resultTooLarge",
    ) {
        super(message);
        this.name = "RunbookDataPlaneQueryError";
    }
}

export async function runRunbookDataPlaneQuery(
    request: RunbookDataPlaneQueryRequest,
): Promise<unknown[][]> {
    const service = await SqlDataPlaneService.get().serviceForProfile(
        request.prepared.profileRef.profileFingerprint,
    );
    try {
        return (
            await runDataPlaneQueryCore({
                service,
                profile: request.prepared.profileRef,
                auth: request.prepared.auth,
                database: request.database,
                applicationName: request.applicationName,
                sql: request.sql,
                tag: request.tag,
                isCancellationRequested: request.isCancellationRequested,
                ...(request.maxRows !== undefined ? { maxRows: request.maxRows } : {}),
                ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
            })
        ).rows;
    } catch (error) {
        if (error instanceof DataPlaneQueryCoreError) {
            throw new RunbookDataPlaneQueryError(error.message, error.code);
        }
        throw error;
    }
}

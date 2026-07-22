/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Small STS v2/SQL Data Plane query seam for bounded Runbook providers. */

import { PreparedConnection } from "../../services/metadata/profileAuthAdapter";
import { IQueryEventSink } from "../../services/sqlDataPlane/api";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";

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
    if (request.isCancellationRequested()) {
        throw new RunbookDataPlaneQueryError("The query was cancelled.", "cancelled");
    }
    const service = await SqlDataPlaneService.get().serviceForProfile(
        request.prepared.profileRef.profileFingerprint,
    );
    const session = await service.openSession({
        profile: request.prepared.profileRef,
        database: request.database,
        applicationName: request.applicationName,
        auth: request.prepared.auth,
    });
    const maxRows = request.maxRows ?? 1000;
    const rows: unknown[][] = [];
    let errorMessage: string | undefined;
    let handle: ReturnType<typeof session.execute> | undefined;
    const cancellationPoll = setInterval(() => {
        if (request.isCancellationRequested() && handle) {
            void handle.cancel().catch(() => undefined);
        }
    }, 50);
    try {
        const sink: IQueryEventSink = {
            onResultSetStarted: () => undefined,
            onRowsPage: (page) => {
                if (rows.length + page.compact.values.length > maxRows) {
                    throw new RunbookDataPlaneQueryError(
                        "The SQL data plane returned more rows than the provider contract allows.",
                        "resultTooLarge",
                    );
                }
                rows.push(...page.compact.values);
            },
            onMessage: (message) => {
                if (message.kind === "error") {
                    errorMessage = message.text;
                }
            },
            onComplete: () => undefined,
        };
        handle = session.execute(
            request.sql,
            {
                priority: "background",
                commandKind: "metadata",
                tag: request.tag,
                pageRows: Math.min(256, maxRows),
                pageBytes: 256 * 1024,
                maxCellBytes: 64 * 1024,
                timeoutMs: request.timeoutMs ?? 120_000,
                expectedDatabase: request.database,
            },
            sink,
        );
        const completion = await handle.completion;
        if (request.isCancellationRequested() || completion.status === "canceled") {
            throw new RunbookDataPlaneQueryError("The query was cancelled.", "cancelled");
        }
        if (completion.status !== "succeeded") {
            throw new RunbookDataPlaneQueryError(
                errorMessage ?? `The query completed with status '${completion.status}'.`,
                "queryFailed",
            );
        }
        return rows;
    } finally {
        clearInterval(cancellationPoll);
        await session.close({ reason: "runbookProviderComplete" }).catch(() => undefined);
    }
}

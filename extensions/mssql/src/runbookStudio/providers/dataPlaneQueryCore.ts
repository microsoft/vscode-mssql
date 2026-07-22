/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Host-neutral bounded SQL Data Plane query core. */

import type {
    ColumnMetadata,
    IQueryEventSink,
    ISqlConnectionService,
    QueryCompleteSummary,
    ServerMessage,
    SqlConnectionProfileRef,
    AuthProviderBundle,
} from "../../services/sqlDataPlane/api";

export interface DataPlaneQueryCoreRequest {
    service: ISqlConnectionService;
    profile: SqlConnectionProfileRef;
    auth: AuthProviderBundle;
    database: string;
    applicationName: string;
    sql: string;
    tag: string;
    isCancellationRequested: () => boolean;
    maxRows?: number;
    timeoutMs?: number;
}

export interface DataPlaneQueryCoreResult {
    columns: readonly ColumnMetadata[];
    rows: unknown[][];
    messages: readonly ServerMessage[];
    completion: QueryCompleteSummary;
}

export class DataPlaneQueryCoreError extends Error {
    constructor(
        message: string,
        public readonly code: "cancelled" | "queryFailed" | "resultTooLarge",
    ) {
        super(message);
        this.name = "DataPlaneQueryCoreError";
    }
}

const MAX_CAPTURED_MESSAGES = 256;
const MAX_MESSAGE_CHARACTERS = 4096;

function boundServerMessage(message: ServerMessage): ServerMessage {
    if (message.text.length <= MAX_MESSAGE_CHARACTERS) {
        return message;
    }
    return {
        ...message,
        text: `${message.text.slice(0, MAX_MESSAGE_CHARACTERS)}\u2026`,
    };
}

export async function runDataPlaneQueryCore(
    request: DataPlaneQueryCoreRequest,
): Promise<DataPlaneQueryCoreResult> {
    if (request.isCancellationRequested()) {
        throw new DataPlaneQueryCoreError("The query was cancelled.", "cancelled");
    }
    const session = await request.service.openSession({
        profile: request.profile,
        database: request.database,
        applicationName: request.applicationName,
        auth: request.auth,
    });
    const maxRows = request.maxRows ?? 1000;
    const rows: unknown[][] = [];
    const messages: ServerMessage[] = [];
    let columns: readonly ColumnMetadata[] = [];
    let errorMessage: string | undefined;
    let handle: ReturnType<typeof session.execute> | undefined;
    const cancellationPoll = setInterval(() => {
        if (request.isCancellationRequested() && handle) {
            void handle.cancel().catch(() => undefined);
        }
    }, 50);
    try {
        const sink: IQueryEventSink = {
            onResultSetStarted: (metadata) => {
                if (columns.length === 0) {
                    columns = metadata.columns;
                }
            },
            onRowsPage: (page) => {
                if (rows.length + page.compact.values.length > maxRows) {
                    throw new DataPlaneQueryCoreError(
                        "The SQL data plane returned more rows than the provider contract allows.",
                        "resultTooLarge",
                    );
                }
                rows.push(...page.compact.values);
            },
            onMessage: (message) => {
                const bounded = boundServerMessage(message);
                if (messages.length < MAX_CAPTURED_MESSAGES) {
                    messages.push(bounded);
                }
                if (bounded.kind === "error" && errorMessage === undefined) {
                    errorMessage = bounded.text;
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
            throw new DataPlaneQueryCoreError("The query was cancelled.", "cancelled");
        }
        if (completion.status !== "succeeded") {
            throw new DataPlaneQueryCoreError(
                errorMessage ??
                    completion.error?.message ??
                    `The query completed with status '${completion.status}' without provider error details. Verify the bound server and database.`,
                "queryFailed",
            );
        }
        return { columns, rows, messages, completion };
    } finally {
        clearInterval(cancellationPoll);
        await session.close({ reason: "runbookProviderComplete" }).catch(() => undefined);
    }
}

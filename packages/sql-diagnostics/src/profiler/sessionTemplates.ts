/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Built-in Extended Events session templates.
 *
 * Without these the profiler could only attach to a session someone had already created by
 * hand, which is a poor first run. Each template builds a complete CREATE EVENT SESSION
 * statement for the server it is going to run on: Azure SQL Database scopes sessions to the
 * database and offers a smaller event set than a boxed instance.
 *
 * No target is declared. The live stream reads the dispatch stream directly through
 * sys.fn_MSxe_read_event_stream, so a ring buffer or file target would only cost memory and
 * disk without being read.
 */

import { ServerCapabilities, xeventCatalog } from "../core/platform";
import { quoteName } from "./sessionManager";

export interface SessionTemplate {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    /** Events collected, in the `package.event` form SQL Server expects. */
    readonly events: readonly string[];
    /** Actions added to every event in the template. */
    readonly actions: readonly string[];
    /** Filter predicate, applied to every event. Omitted when the template collects all. */
    readonly filter?: string;
}

/** Actions available everywhere Extended Events runs, boxed or Azure. */
const COMMON_ACTIONS = [
    "sqlserver.database_name",
    "sqlserver.client_app_name",
    "sqlserver.session_id",
    "sqlserver.username",
    "sqlserver.query_hash",
] as const;

/** Also available on a boxed instance, where sessions are server-scoped. */
const SERVER_ACTIONS = ["sqlserver.client_hostname", "sqlserver.server_principal_name"] as const;

/**
 * The extension's own sessions are excluded from every template. A profiler that captures the
 * queries it runs to drive itself produces a feedback loop and buries the user's own traffic.
 */
const EXCLUDE_SELF = "sqlserver.client_app_name <> N'vscode-mssql (diagnostics)'";

export const standardTemplate: SessionTemplate = {
    id: "standard",
    title: "Standard",
    description: "Completed batches and remote procedure calls, with timing and I/O.",
    events: ["sqlserver.sql_batch_completed", "sqlserver.rpc_completed"],
    actions: COMMON_ACTIONS,
    filter: EXCLUDE_SELF,
};

export const tsqlTemplate: SessionTemplate = {
    id: "tsql",
    title: "T-SQL",
    description: "Statements as they start, for seeing work that never finished.",
    events: ["sqlserver.sql_batch_starting", "sqlserver.rpc_starting"],
    actions: COMMON_ACTIONS,
    filter: EXCLUDE_SELF,
};

export const tuningTemplate: SessionTemplate = {
    id: "tuning",
    title: "Tuning",
    description:
        "Completed statements only, above 100 ms, for finding the queries worth rewriting.",
    events: ["sqlserver.sql_batch_completed", "sqlserver.rpc_completed"],
    actions: COMMON_ACTIONS,
    // Duration is microseconds here, so this is 100 ms and not 100 seconds.
    filter: `duration > 100000 AND ${EXCLUDE_SELF}`,
};

export const errorsTemplate: SessionTemplate = {
    id: "errors",
    title: "Errors and warnings",
    description: "Errors the server raised, plus the attentions that cancelled a statement.",
    events: ["sqlserver.error_reported", "sqlserver.attention"],
    actions: COMMON_ACTIONS,
    filter: EXCLUDE_SELF,
};

export const sessionTemplates: readonly SessionTemplate[] = [
    standardTemplate,
    tsqlTemplate,
    tuningTemplate,
    errorsTemplate,
];

/** Templates usable on this server. Nothing is offered where Extended Events do not exist. */
export function templatesFor(capabilities: ServerCapabilities): readonly SessionTemplate[] {
    if (capabilities.xeventScope === "none") {
        return [];
    }
    return sessionTemplates;
}

/**
 * Builds the CREATE EVENT SESSION statement for a template.
 *
 * The session name is quoted rather than interpolated, so a name carrying a bracket cannot
 * close the identifier and append a statement of its own.
 */
export function buildCreateStatement(
    template: SessionTemplate,
    sessionName: string,
    capabilities: ServerCapabilities,
): string {
    const { scope } = xeventCatalog(capabilities);
    const actions = [
        ...template.actions,
        // Hostname and principal are server-level actions that Azure SQL Database rejects.
        ...(scope === "SERVER" ? SERVER_ACTIONS : []),
    ];

    const addAction = `ACTION(${actions.join(", ")})`;
    const where = template.filter ? `\n        WHERE (${template.filter})` : "";
    const events = template.events
        .map((event) => `    ADD EVENT ${event}(\n        ${addAction}${where})`)
        .join(",\n");

    // MAX_MEMORY bounds the dispatch buffers the live stream reads. NO_EVENT_LOSS would
    // stall user queries when the reader falls behind, which is never the right trade for a
    // diagnostic tool, so events are allowed to drop and the gap is reported instead.
    return `CREATE EVENT SESSION ${quoteName(sessionName)} ON ${scope}
${events}
    WITH (
        MAX_MEMORY = 4096 KB,
        EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,
        MAX_DISPATCH_LATENCY = 1 SECONDS,
        STARTUP_STATE = OFF)`;
}

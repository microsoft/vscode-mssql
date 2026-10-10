/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SqlReadOptions } from "../../common/sqlReader";

/**
 * A running or queued request. Session and request IDs are strings because Synapse dedicated
 * pools use text IDs. Times are milliseconds. Reads and writes are 8 KB pages.
 */
export interface ActiveRequest {
    readonly sessionId: string;
    readonly requestId?: string;
    readonly status?: string;
    readonly command?: string;
    /** True when a Synapse dedicated pool request waits in the queue and has not started. */
    readonly queued?: boolean;
    readonly elapsedMs?: number;
    readonly cpuMs?: number;
    readonly logicalReads?: number;
    readonly reads?: number;
    readonly writes?: number;
    readonly grantedMemoryKb?: number;
    readonly waitType?: string;
    readonly waitMs?: number;
    readonly waitResource?: string;
    readonly blockingSessionId?: string;
    readonly openTransactionCount?: number;
    readonly databaseName?: string;
    readonly loginName?: string;
    readonly hostName?: string;
    readonly programName?: string;
    /** The current statement, up to 4000 characters. */
    readonly statementText?: string;
    readonly queryHash?: string;
    readonly queryPlanHash?: string;
    /** Synapse dedicated pool request label. */
    readonly label?: string;
    /** Synapse dedicated pool resource class or workload group. */
    readonly resourceClass?: string;
}

/**
 * A session that blocks other sessions but has no running request.
 */
export interface IdleSession {
    readonly sessionId: string;
    readonly status?: string;
    readonly loginName?: string;
    readonly hostName?: string;
    readonly programName?: string;
    readonly openTransactionCount?: number;
    readonly lastRequestStartTime?: string;
    readonly lastRequestEndTime?: string;
    /** The last statement of the session, up to 4000 characters. */
    readonly lastStatementText?: string;
}

/** Options of the activity reads: the active requests and the sessions. */
export interface ActivityReadOptions extends SqlReadOptions {
    /**
     * Leaves out the session of the read itself. Default true. A caller that shows everything,
     * such as a monitoring tool that also shows its own work, sets it to false.
     */
    readonly excludeOwnSession?: boolean;
}

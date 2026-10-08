/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlResultSet } from "../../../common/sqlReader";

/*
 * Port of QueryStoreOperationalMode, QueryStoreOperationalStatus, QueryStoreReadOnlyReason, and
 * the operational mode functions of Utils from SQL Tools Service.
 */

/** `sys.database_query_store_options.actual_state`. The error state (3) is not a status. */
export type QueryStoreOperationalStatus = "off" | "readOnly" | "readWrite" | "readCapture";

export const queryStoreOperationalStatusIds: Readonly<Record<QueryStoreOperationalStatus, number>> =
    {
        off: 0,
        readOnly: 1,
        readWrite: 2,
        readCapture: 4,
    };

export interface QueryStoreOperationalMode {
    readonly operationalStatus: QueryStoreOperationalStatus;
    /** `sys.database_query_store_options.readonly_reason`, a set of flags. */
    readonly readOnlyReason: number;
}

/** Why Query Store is read-only. Callers show localized text for each code. */
export type QueryStoreReadOnlyReason =
    | "dbReadOnly"
    | "dbInSingleUserMode"
    | "dbInEmergencyMode"
    | "dbInLogAcceptMode"
    | "diskSizeLimit"
    | "stmtHashMapMemoryLimit";

/** The `readonly_reason` flag of each reason. */
export const queryStoreReadOnlyReasonFlags: Readonly<Record<QueryStoreReadOnlyReason, number>> = {
    dbReadOnly: 0x00000001,
    dbInSingleUserMode: 0x00000002,
    dbInEmergencyMode: 0x00000004,
    dbInLogAcceptMode: 0x00000008,
    diskSizeLimit: 0x00010000,
    stmtHashMapMemoryLimit: 0x00020000,
};

/**
 * Reads the state of Query Store. The text is the C# `Utils.GetQueryStoreOperationalMode` query.
 * Map the result with {@link mapQueryStoreOperationalMode}.
 */
export const queryStoreOperationalModeQuery =
    "SELECT actual_state, readonly_reason FROM sys.database_query_store_options";

/**
 * Maps the first row of {@link queryStoreOperationalModeQuery}. The status is `off` when there
 * is no row or the state is not a status, like the C# code.
 */
export function mapQueryStoreOperationalMode(
    resultSets: readonly SqlResultSet[],
): QueryStoreOperationalMode {
    const row = resultSets[0]?.rows[0];
    if (!row) {
        return { operationalStatus: "off", readOnlyReason: 0 };
    }
    const actualState = Number(row[0]);
    const status = (
        Object.keys(queryStoreOperationalStatusIds) as QueryStoreOperationalStatus[]
    ).find((key) => queryStoreOperationalStatusIds[key] === actualState);
    const readOnlyReason = Number(row[1]);
    return {
        operationalStatus: status ?? "off",
        readOnlyReason: Number.isInteger(readOnlyReason) ? readOnlyReason : 0,
    };
}

/** True for `readOnly` and `readCapture`. C# `IsReadOnlyOrReadCapture`. */
export function isReadOnlyOrReadCapture(mode: QueryStoreOperationalMode): boolean {
    return mode.operationalStatus === "readOnly" || mode.operationalStatus === "readCapture";
}

/**
 * Returns the reason to show for the `readonly_reason` flags, or undefined when no flag is set.
 * It checks the flags in the order of the C# `Utils.GetQueryStoreReadOnlyReasonString`. That
 * function shows the database read-only text for the disk size limit; this port returns
 * `diskSizeLimit`.
 */
export function getQueryStoreReadOnlyReason(
    readOnlyReason: number,
): QueryStoreReadOnlyReason | undefined {
    const order: QueryStoreReadOnlyReason[] = [
        "stmtHashMapMemoryLimit",
        "diskSizeLimit",
        "dbInLogAcceptMode",
        "dbInEmergencyMode",
        "dbInSingleUserMode",
        "dbReadOnly",
    ];
    return order.find((reason) => (readOnlyReason & queryStoreReadOnlyReasonFlags[reason]) !== 0);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plain-JSON contract of the performance service (`src/performance/`). Copilot tools and webview
 * dialogs read the same values. Every value is a code, not display text: callers show localized
 * text for each code.
 */

import type { PerfResult } from "sql-core/performance";

export type * from "sql-core/performance";
export type { PlatformInfo, SessionPurpose, SqlPlatform } from "sql-core";

/**
 * Names the connection to inspect. Pass the owner URI of an active connection (Copilot tools
 * call it `connectionId`) or the ID of a saved connection profile. When `database` is absent,
 * the connection's database is used.
 */
export type PerformanceConnectionReference =
    | { readonly ownerUri: string; readonly profileId?: undefined; readonly database?: string }
    | { readonly profileId: string; readonly ownerUri?: undefined; readonly database?: string };

export type PerformanceUnavailableReason =
    /** `mssql.enableExperimentalFeatures` or `mssql.sqlDataPlane.enabled` is off. */
    | "dataPlaneDisabled"
    /** The settings are on, but the window has not reloaded since they changed. */
    | "reloadRequired"
    /** The SQL data plane did not start or cannot open sessions. */
    | "dataPlaneUnavailable"
    /** No active connection or saved profile matches the reference. */
    | "connectionNotFound"
    /** The SQL data plane does not support the authentication type of the connection. */
    | "authenticationUnsupported"
    /** The session did not open, for example because the server is not reachable. */
    | "connectionFailed";

export interface PerformanceUnavailable {
    readonly status: "unavailable";
    readonly reason: PerformanceUnavailableReason;
    /** The settings that must be on, for `dataPlaneDisabled` and `reloadRequired`. */
    readonly requiredSettings?: readonly string[];
    /** The data plane's untranslated error text, for logs and agent tools. */
    readonly detail?: string;
}

/**
 * A value or result set that the data plane shortened. The result keeps the prefix that the data
 * plane returned, so a shortened plan XML is not valid XML.
 */
export interface PerformanceTruncation {
    /** Zero-based result set of the read that returned the value. */
    readonly resultSet: number;
    /** The column of a shortened value. Absent when the data plane dropped rows of the set. */
    readonly column?: string;
    /** Zero-based row of a shortened value. */
    readonly row?: number;
    /** Length of the returned prefix. Binary values count hex digits. */
    readonly returnedLength?: number;
    /** Size of the full value in bytes, when the data plane reports it. */
    readonly originalBytes?: number;
    /** The data plane's reason, for example `maxCellBytes`. */
    readonly reason: string;
}

/**
 * A sql-core result, plus the values that the data plane shortened. `truncated` is absent when
 * nothing was shortened.
 */
export type PerformanceResult<T> = PerfResult<T> & {
    readonly truncated?: readonly PerformanceTruncation[];
};

export function isPerformanceUnavailable(value: unknown): value is PerformanceUnavailable {
    return (
        typeof value === "object" &&
        !!value &&
        (value as { status?: unknown }).status === "unavailable"
    );
}

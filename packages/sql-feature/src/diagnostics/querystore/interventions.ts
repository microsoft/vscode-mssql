/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServerCapabilities } from "../../core/platform";

export type QueryStorePlanAction = "force" | "unforce";
export type QueryStoreMaintenanceAction = "disable" | "flush" | "clearHistory";

export interface QueryStoreInterventionCapabilities {
    readonly planForcing: boolean;
    readonly hints: boolean;
    readonly maintenance: Readonly<Record<QueryStoreMaintenanceAction, boolean>>;
    readonly reason?: string;
}

export function queryStoreInterventionCapabilities(
    capabilities: ServerCapabilities,
): QueryStoreInterventionCapabilities {
    const supported = capabilities.hasQueryStore;
    const hints =
        supported &&
        (capabilities.platform === "azureSqlDatabase" ||
            capabilities.platform === "fabric" ||
            (capabilities.platform === "sqlServer" && (capabilities.majorVersion ?? 0) >= 16) ||
            (capabilities.platform === "managedInstance" &&
                (capabilities.majorVersion ?? 0) >= 16));
    return {
        planForcing: supported,
        hints,
        maintenance: {
            disable: supported && capabilities.platform !== "azureSqlDatabase",
            flush: supported,
            clearHistory: supported,
        },
        ...(supported ? {} : { reason: "Query Store is unavailable on this target." }),
    };
}

export function compileQueryStorePlanAction(
    queryId: number,
    planId: number,
    action: QueryStorePlanAction,
): string {
    const query = positiveId(queryId, "queryId");
    const plan = positiveId(planId, "planId");
    return action === "force"
        ? `EXEC sys.sp_query_store_force_plan @query_id = ${query}, @plan_id = ${plan};`
        : `EXEC sys.sp_query_store_unforce_plan @query_id = ${query}, @plan_id = ${plan};`;
}

export function compileQueryStoreHint(queryId: number, hint: string): string {
    const query = positiveId(queryId, "queryId");
    const value = hint.trim();
    if (!value || value.length > 4000 || value.includes("\0")) {
        throw new Error("A Query Store hint must contain 1 to 4000 valid characters.");
    }
    return `EXEC sys.sp_query_store_set_hints @query_id = ${query}, @query_hints = N'${value.replace(/'/g, "''")}';`;
}

export function compileClearQueryStoreHint(queryId: number): string {
    return `EXEC sys.sp_query_store_clear_hints @query_id = ${positiveId(queryId, "queryId")};`;
}

export function compileQueryStoreMaintenance(
    database: string,
    action: QueryStoreMaintenanceAction,
): string {
    const name = quoteDatabase(database);
    switch (action) {
        case "disable":
            return `ALTER DATABASE ${name} SET QUERY_STORE = OFF;`;
        case "flush":
            return `ALTER DATABASE ${name} SET QUERY_STORE FLUSH;`;
        case "clearHistory":
            return `ALTER DATABASE ${name} SET QUERY_STORE CLEAR ALL;`;
    }
}

function positiveId(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}

function quoteDatabase(database: string): string {
    if (!database.trim() || database.includes("\0")) {
        throw new Error("A database name is required.");
    }
    return "[" + database.replace(/]/g, "]]") + "]";
}

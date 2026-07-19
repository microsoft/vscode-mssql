/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local SQL activity delegate (the "local" runtime lane): executes
 * sql.query.read against a REAL extension-owned connection through the
 * normal ConnectionManager + STS `query/simpleexecute` path, while every
 * other activity keeps the shared deterministic semantics. Guardrails:
 *   - only single read-only SELECT/WITH statements execute (a policy engine
 *     replaces this conservative check in RBS2-13, but the refusal is
 *     visible and typed, never silent);
 *   - the connection binds by PROFILE ID (an opaque host handle — plans
 *     never carry connection strings or credentials);
 *   - each activity connects on a private runbook URI and disconnects in
 *     finally, so runs never leak sessions.
 */

import type * as mssql from "vscode-mssql";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { isReadOnlySql } from "../readOnlySql";
import { ActivityExecutionDelegate, NodeExecution } from "./fakeRuntimeAdapter";

export { isReadOnlySql } from "../readOnlySql";

/** Injected host operations (real implementations wire ConnectionManager +
 *  SqlToolsServiceClient; tests inject fakes). */
export interface LocalSqlOperations {
    connect(profileId: string, ownerUri: string): Promise<boolean>;
    execute(ownerUri: string, sql: string): Promise<mssql.SimpleExecuteResult>;
    disconnect(ownerUri: string): Promise<void>;
}

const MAX_STORED_ROWS = 5000;

let queryCounter = 0;

export class LocalSqlActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;

    constructor(private readonly operations: LocalSqlOperations) {}

    public async executeActivity(
        node: RunbookPlanNode,
        binding: {
            parameterValues: Record<string, string | number | boolean | null>;
            resolveBind: (input: unknown) => unknown;
        },
    ): Promise<NodeExecution | undefined> {
        if (node.activityKind !== "sql.query.read") {
            // Built-in deterministic semantics handle everything else.
            return undefined;
        }
        const profileId = binding.resolveBind(node.inputs?.connection);
        if (typeof profileId !== "string" || profileId.length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("connection"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        const sql = binding.resolveBind(node.inputs?.sql);
        if (typeof sql !== "string" || sql.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("sql"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        if (!isReadOnlySql(sql)) {
            return {
                success: false,
                message: LocRunbookStudio.sqlNotReadOnly,
                errorCode: "RunbookStudio.ActivityPolicyDenied",
            };
        }

        queryCounter++;
        const ownerUri = `runbookstudio://query/${queryCounter.toString(36)}/${node.id}`;
        let connected = false;
        try {
            connected = await this.operations.connect(profileId, ownerUri);
            if (!connected) {
                return {
                    success: false,
                    message: LocRunbookStudio.connectFailed,
                    errorCode: "RunbookStudio.ActivityFailed",
                };
            }
            const result = await this.operations.execute(ownerUri, sql);
            const rows = (result.rows ?? [])
                .slice(0, MAX_STORED_ROWS)
                .map((row) => row.map((cell) => (cell.isNull ? null : cell.displayValue)));
            return {
                success: true,
                message: `${result.rowCount} rows`,
                output: {
                    contract: "rowset/1",
                    columns: (result.columnInfo ?? []).map((column) => column.columnName),
                    rows,
                },
                values: { rowCount: result.rowCount },
            };
        } finally {
            if (connected) {
                try {
                    await this.operations.disconnect(ownerUri);
                } catch {
                    // best-effort cleanup; the run outcome is already decided
                }
            }
        }
    }
}

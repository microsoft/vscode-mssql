/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as mssql from "vscode-mssql";

const MAX_TSQLT_TESTS = 1000;
const MAX_TSQLT_IDENTIFIER_LENGTH = 128;
const MAX_TSQLT_MESSAGE_LENGTH = 4096;

export interface LocalTsqltSelection {
    suite?: string;
    test?: string;
}

export interface LocalTsqltTestCase {
    suite: string;
    name: string;
    result: "passed" | "failed" | "error" | "skipped";
    message: string;
    durationMs: number;
}

export interface LocalTsqltResult {
    tests: LocalTsqltTestCase[];
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    allPassed: boolean;
    truncatedMessageCount: number;
}

export class LocalTsqltContractError extends Error {
    constructor(
        message: string,
        public readonly errorCode: string,
    ) {
        super(message);
        this.name = "LocalTsqltContractError";
    }
}

export function normalizeLocalTsqltSelection(
    suiteValue: unknown,
    testValue: unknown,
): LocalTsqltSelection {
    const suite = optionalIdentifier(suiteValue, "suite");
    const test = optionalIdentifier(testValue, "test");
    if (test && !suite) {
        throw new LocalTsqltContractError(
            "A tSQLt test selection requires its suite.",
            "RunbookStudio.BindingInvalid",
        );
    }
    return { ...(suite ? { suite } : {}), ...(test ? { test } : {}) };
}

/** Fixed host-authored batch. Caller values enter one escaped Unicode string
 * literal only; repository SQL and model-authored SQL are never concatenated. */
export function buildLocalTsqltBatch(selection: LocalTsqltSelection): string {
    const selectedName = selection.suite
        ? selection.test
            ? `${quoteSqlIdentifier(selection.suite)}.${quoteSqlIdentifier(selection.test)}`
            : quoteSqlIdentifier(selection.suite)
        : undefined;
    const invocation = selectedName
        ? `EXEC [tSQLt].[Run] N'${escapeSqlString(selectedName)}';`
        : "EXEC [tSQLt].[RunAll];";
    const requiredRunner = selectedName ? "Run" : "RunAll";
    return [
        "SET NOCOUNT ON;",
        `IF OBJECT_ID(N'[tSQLt].[TestResult]', N'U') IS NULL OR OBJECT_ID(N'[tSQLt].[${requiredRunner}]', N'P') IS NULL`,
        "    THROW 51000, N'Runbook Studio requires tSQLt in the disposable target.', 1;",
        "BEGIN TRY",
        `    ${invocation}`,
        "END TRY",
        "BEGIN CATCH",
        "    -- tSQLt reports failed/error tests as a severity-16 summary. Preserve",
        "    -- those rows as evidence, but do not hide a failure before any test ran.",
        "    IF NOT EXISTS (SELECT 1 FROM [tSQLt].[TestResult]) THROW;",
        "END CATCH;",
        "SELECT [Class] AS [suite_name], [TestCase] AS [test_name], [Result] AS [result],",
        "       ISNULL([Msg], N'') AS [message],",
        "       ISNULL(CONVERT(bigint, DATEDIFF(millisecond, [TestStartTime], [TestEndTime])), 0) AS [duration_ms]",
        "FROM [tSQLt].[TestResult]",
        "ORDER BY [Id];",
    ].join("\n");
}

export function parseLocalTsqltResult(result: mssql.SimpleExecuteResult): LocalTsqltResult {
    if (result.rowCount < 1 || result.rows.length < 1) {
        throw new LocalTsqltContractError(
            "tSQLt returned no test results.",
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    if (result.rowCount !== result.rows.length) {
        throw new LocalTsqltContractError(
            "tSQLt returned an inconsistent result count.",
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    if (result.rowCount > MAX_TSQLT_TESTS || result.rows.length > MAX_TSQLT_TESTS) {
        throw new LocalTsqltContractError(
            `tSQLt returned more than ${MAX_TSQLT_TESTS} test results.`,
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    const columns = result.columnInfo.map((column) =>
        column.columnName.trim().toLocaleLowerCase().replaceAll("_", ""),
    );
    const suiteIndex = columns.indexOf("suitename");
    const testIndex = columns.indexOf("testname");
    const resultIndex = columns.indexOf("result");
    const messageIndex = columns.indexOf("message");
    const durationIndex = columns.indexOf("durationms");
    if (
        suiteIndex < 0 ||
        testIndex < 0 ||
        resultIndex < 0 ||
        messageIndex < 0 ||
        durationIndex < 0
    ) {
        throw new LocalTsqltContractError(
            "tSQLt results did not match the required typed result contract.",
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    let truncatedMessageCount = 0;
    const identities = new Set<string>();
    const tests = result.rows.map((row) => {
        const suite = requiredCell(row[suiteIndex], "suite");
        const name = requiredCell(row[testIndex], "test");
        const identity = `${suite.toLocaleLowerCase()}\0${name.toLocaleLowerCase()}`;
        if (identities.has(identity)) {
            throw new LocalTsqltContractError(
                "tSQLt returned a duplicate test identity.",
                "RunbookStudio.TsqltResultInvalid",
            );
        }
        identities.add(identity);
        const status = requiredCell(row[resultIndex], "result").toLocaleLowerCase();
        const mapped =
            status === "success"
                ? "passed"
                : status === "failure"
                  ? "failed"
                  : status === "error"
                    ? "error"
                    : status === "skipped"
                      ? "skipped"
                      : undefined;
        if (!mapped) {
            throw new LocalTsqltContractError(
                "tSQLt returned an unsupported test status.",
                "RunbookStudio.TsqltResultInvalid",
            );
        }
        const rawMessage = row[messageIndex]?.isNull ? "" : (row[messageIndex]?.displayValue ?? "");
        if (rawMessage.length > MAX_TSQLT_MESSAGE_LENGTH) {
            truncatedMessageCount++;
        }
        const durationValue = requiredCell(row[durationIndex], "duration");
        const durationMs = Number(durationValue);
        if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
            throw new LocalTsqltContractError(
                "tSQLt returned an invalid test duration.",
                "RunbookStudio.TsqltResultInvalid",
            );
        }
        return {
            suite: boundIdentifier(suite),
            name: boundIdentifier(name),
            result: mapped,
            message: rawMessage.slice(0, MAX_TSQLT_MESSAGE_LENGTH),
            durationMs,
        } satisfies LocalTsqltTestCase;
    });
    const passed = tests.filter((test) => test.result === "passed").length;
    const failed = tests.filter((test) => test.result === "failed").length;
    const errors = tests.filter((test) => test.result === "error").length;
    const skipped = tests.filter((test) => test.result === "skipped").length;
    return {
        tests,
        total: tests.length,
        passed,
        failed,
        errors,
        skipped,
        allPassed: passed > 0 && failed === 0 && errors === 0,
        truncatedMessageCount,
    };
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new LocalTsqltContractError(
            `The tSQLt ${label} must be a string.`,
            "RunbookStudio.BindingInvalid",
        );
    }
    const trimmed = value.trim();
    if (
        !trimmed ||
        trimmed.length > MAX_TSQLT_IDENTIFIER_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(trimmed)
    ) {
        throw new LocalTsqltContractError(
            `The tSQLt ${label} is invalid.`,
            "RunbookStudio.BindingInvalid",
        );
    }
    return trimmed;
}

function quoteSqlIdentifier(value: string): string {
    return `[${value.replace(/\]/g, "]]")}]`;
}

function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
}

function requiredCell(cell: mssql.DbCellValue | undefined, label: string): string {
    const value = cell?.isNull ? "" : cell?.displayValue.trim();
    if (!value) {
        throw new LocalTsqltContractError(
            `tSQLt returned an empty ${label} value.`,
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    return value;
}

function boundIdentifier(value: string): string {
    if (value.length > MAX_TSQLT_IDENTIFIER_LENGTH) {
        throw new LocalTsqltContractError(
            "tSQLt returned an oversized test identity.",
            "RunbookStudio.TsqltResultInvalid",
        );
    }
    return value;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral, bounded Schema Compare result consumed by Runbook
 * Studio. The legacy STS comparison contract is intentionally not exposed:
 * providers project into this document before data is retained or sent to a
 * webview.
 */

export const RUNBOOK_SCHEMA_COMPARE_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type RunbookSchemaCompareAction = "add" | "change" | "delete" | "unknown";

export interface RunbookSchemaCompareItem {
    id: string;
    action: RunbookSchemaCompareAction;
    objectType: string;
    sourceName?: string;
    targetName?: string;
    sourceSql?: string;
    targetSql?: string;
}

export interface RunbookSchemaCompareDocument {
    schemaVersion: typeof RUNBOOK_SCHEMA_COMPARE_DOCUMENT_SCHEMA_VERSION;
    source: { kind: "dacpac"; label: string };
    target: { kind: "database"; label: string };
    areEqual: boolean;
    totalDifferences: number;
    items: RunbookSchemaCompareItem[];
    truncated: boolean;
    omittedCount: number;
    provider: {
        /** Diagnostic identity only. Consumers must not branch on it. */
        kind: string;
        contractVersion: number;
    };
}

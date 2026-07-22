/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Complete-schema identity captured from the STS v2 MetadataStore model.
 * The hash covers the provider-neutral full catalog fingerprint; no object
 * names or definitions need to cross into a retained performance result.
 */

export const RUNBOOK_SCHEMA_FINGERPRINT_SCHEMA_VERSION = 1 as const;

export interface RunbookSchemaFingerprintDocument {
    schemaVersion: typeof RUNBOOK_SCHEMA_FINGERPRINT_SCHEMA_VERSION;
    databaseLabel: string;
    schemaSha256: string;
    complete: boolean;
    tableCount: number;
    capturedAtUtc: string;
    freshness: {
        source: string;
        freshness: string;
        validation: string;
    };
    provider: {
        /** Diagnostic identity only. Consumers must not branch on it. */
        kind: string;
        contractVersion: number;
    };
}

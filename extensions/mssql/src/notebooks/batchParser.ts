/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Split SQL into batches on GO separators.
 * GO must appear on its own line (case-insensitive), matching T-SQL convention
 * used in SSMS, ADS, and sqlcmd.
 */
export function parseBatches(code: string): string[] {
    const batches = code.split(/^\s*GO\s*$/gim);
    return batches.map((b) => b.trim()).filter((b) => b.length > 0);
}

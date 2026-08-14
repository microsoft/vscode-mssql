/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Removes separators carried over from the preceding ShowPlan statement without
 * removing the current statement's leading comments or other punctuation.
 */
export function normalizeExecutionPlanQuery(query: string): string {
    return query.replace(/^(?:\s*;\s*)+/, "").trimStart();
}

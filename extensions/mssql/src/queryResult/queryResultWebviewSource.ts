/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const LEGACY_QUERY_RESULT_SOURCE = "queryResult";
export const PREVIEW_QUERY_RESULT_SOURCE = "queryResultPreview";

export function getQueryResultWebviewSource(isBetaResultsGridEnabled: boolean): string {
    return isBetaResultsGridEnabled ? PREVIEW_QUERY_RESULT_SOURCE : LEGACY_QUERY_RESULT_SOURCE;
}

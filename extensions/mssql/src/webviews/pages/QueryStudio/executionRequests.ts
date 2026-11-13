/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsExecuteParams } from "../../../sharedInterfaces/queryStudio";

export interface QueryStudioSelectionLike {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    isEmpty(): boolean;
}

export function executeParamsForSelection(
    selection: QueryStudioSelectionLike | null | undefined,
): QsExecuteParams {
    if (!selection || selection.isEmpty()) {
        return { scope: "document" };
    }
    return {
        scope: "selection",
        selection: {
            startLine: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLine: selection.endLineNumber,
            endColumn: selection.endColumn,
        },
    };
}

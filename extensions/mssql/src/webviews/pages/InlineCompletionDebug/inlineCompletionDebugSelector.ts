/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InlineCompletionDebugReducers,
    InlineCompletionDebugWebviewState,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useInlineCompletionDebugSelector<T>(
    selector: (state: InlineCompletionDebugWebviewState) => T,
    equals?: (left: T, right: T) => boolean,
) {
    return useVscodeSelector<InlineCompletionDebugWebviewState, InlineCompletionDebugReducers, T>(
        selector,
        equals,
    );
}

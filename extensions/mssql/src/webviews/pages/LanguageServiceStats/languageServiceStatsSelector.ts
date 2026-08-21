/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageServiceStatsWebviewState } from "../../../sharedInterfaces/languageServiceStats";
import { useVscodeSelector } from "../../common/useVscodeSelector";

/** Selects narrowly so a fetch arriving does not re-render the pipeline cards. */
export function useStatsSelector<T>(
    selector: (state: LanguageServiceStatsWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<LanguageServiceStatsWebviewState, void, T>(selector, equals);
}

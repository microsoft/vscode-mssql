/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../../../sharedInterfaces/changelog";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useChangelogSelector<T>(
    selector: (state: ChangelogWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ChangelogWebviewState, void, T>(selector, equals);
}

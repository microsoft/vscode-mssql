/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DacpacDialogWebviewState } from "../../../sharedInterfaces/dacpacDialog";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useDacpacDialogSelector<T>(
    selector: (state: DacpacDialogWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<DacpacDialogWebviewState, void, T>(selector, equals);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionDialogWebviewState } from "../../../sharedInterfaces/connectionDialog";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useConnectionDialogSelector<T>(
    selector: (state: ConnectionDialogWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ConnectionDialogWebviewState, T>(selector, equals);
}

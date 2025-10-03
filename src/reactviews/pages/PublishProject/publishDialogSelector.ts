/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PublishDialogReducers, PublishDialogState } from "../../../sharedInterfaces/publishDialog";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function usePublishDialogSelector<T>(
    selector: (state: PublishDialogState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<PublishDialogState, PublishDialogReducers, T>(selector, equals);
}

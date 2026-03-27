/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BackupDatabaseFormState,
    BackupDatabaseReducers,
} from "../../../../sharedInterfaces/backup";
import { ObjectManagementWebviewState } from "../../../../sharedInterfaces/objectManagement";
import { useVscodeSelector } from "../../../common/useVscodeSelector";

export function useBackupDatabaseSelector<T>(
    selector: (state: ObjectManagementWebviewState<BackupDatabaseFormState>) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<
        ObjectManagementWebviewState<BackupDatabaseFormState>,
        BackupDatabaseReducers<BackupDatabaseFormState>,
        T
    >(selector, equals);
}

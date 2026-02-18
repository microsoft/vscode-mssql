/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureDataStudioMigrationWebviewState } from "../../../sharedInterfaces/azureDataStudioMigration";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useAzureDataStudioMigrationSelector<T>(
    selector: (state: AzureDataStudioMigrationWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<AzureDataStudioMigrationWebviewState, void, T>(selector, equals);
}

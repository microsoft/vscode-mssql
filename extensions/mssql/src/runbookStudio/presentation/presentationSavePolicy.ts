/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RUNBOOK_FS_SCHEME } from "../runbookFileSystem";

/** Runtime semantics revert an approved asset to draft on any authoring PUT.
 * Only library-backed documents need the explicit pre-commit warning. */
export function presentationSaveRequiresDraftDemotionConfirmation(
    documentScheme: string,
    lifecycleState: string | undefined,
): boolean {
    return documentScheme === RUNBOOK_FS_SCHEME && lifecycleState === "approved";
}

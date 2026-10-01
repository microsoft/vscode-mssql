/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Approximate token counts are sufficient for provider ranking and budget checks.
// SDK providers replace this with exact usage when the API reports it.
export function approximateTokenCount(text: string): number {
    if (!text) {
        return 0;
    }

    return Math.ceil(text.length / 4);
}

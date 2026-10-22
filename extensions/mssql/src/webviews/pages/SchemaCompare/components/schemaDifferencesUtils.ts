/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SchemaDifferenceNavigationKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * Returns the row that should receive focus for a vertical navigation key. Group rows participate
 * in arrow navigation, while Home and End go directly to the first or last visible difference.
 */
export function getSchemaDifferenceNavigationTarget(
    rowKinds: readonly ("diff" | "group")[],
    currentIndex: number,
    key: SchemaDifferenceNavigationKey,
): number | undefined {
    if (currentIndex < 0 || currentIndex >= rowKinds.length || rowKinds.length === 0) {
        return undefined;
    }

    switch (key) {
        case "ArrowUp":
            return Math.max(currentIndex - 1, 0);
        case "ArrowDown":
            return Math.min(currentIndex + 1, rowKinds.length - 1);
        case "Home": {
            const firstDifferenceIndex = rowKinds.indexOf("diff");
            return firstDifferenceIndex >= 0 ? firstDifferenceIndex : undefined;
        }
        case "End": {
            const lastDifferenceIndex = rowKinds.lastIndexOf("diff");
            return lastDifferenceIndex >= 0 ? lastDifferenceIndex : undefined;
        }
    }
}

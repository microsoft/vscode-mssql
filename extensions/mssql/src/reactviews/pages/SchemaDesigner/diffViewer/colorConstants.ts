/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralized color constants for the diff viewer using VS Code theme variables.
 * These colors ensure consistency between:
 * - ChangeItem badges in the diff drawer
 * - Canvas node indicators (borders, icons)
 * - CSS class definitions
 *
 * All colors use VS Code's gitDecoration variables with sensible fallbacks
 * to maintain theme compatibility in both light and dark modes.
 */
export const DIFF_COLORS = {
    /** Green - for new tables, columns, foreign keys */
    addition: "var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
    /** Yellow/Orange - for changed properties */
    modification: "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
    /** Red - for removed items */
    deletion: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
} as const;

/**
 * Type for diff color categories
 */
export type DiffColorType = keyof typeof DIFF_COLORS;

/**
 * Get the color value for a given diff type
 * @param type - The type of diff change
 * @returns The CSS color value (VS Code variable with fallback)
 */
export function getDiffColor(type: DiffColorType): string {
    return DIFF_COLORS[type];
}

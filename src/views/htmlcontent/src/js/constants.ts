/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Note: The new constants in this file should be added to localization\xliff\constants\localizedConstants.enu.xlf so the localized texts get loaded here */

/** Results Pane Labels */
export let maximizeLabel = "Maximize";
export let restoreLabel = "Restore";
export let saveCSVLabel = "Save as CSV";
export let saveJSONLabel = "Save as JSON";
export let saveExcelLabel = "Save as Excel";
export let resultPaneLabel = "Results";
export let selectAll = "Select all";
export let copyLabel = "Copy";
export let copyWithHeadersLabel = "Copy with Headers";
export let copyHeadersLabel = "Copy All Headers";

/** Messages Pane Labels */
export let executeQueryLabel = "Executing query...";
export let messagePaneLabel = "Messages";
export let lineSelectorFormatted = "Line {0}";
export let elapsedTimeLabel = "Total execution time: {0}";

/** Warning message for save icons */
export let msgCannotSaveMultipleSelections =
    "Save results command cannot be used with multiple selections.";
export let accessShortcut = "Access through shortcut";

export function loadLocalizedConstant(key: string, value: string): void {
    // Update the value of the property with the name equal to key in this file
    this[key] = value;
}

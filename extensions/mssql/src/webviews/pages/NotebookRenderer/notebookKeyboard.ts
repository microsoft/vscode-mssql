/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { eventMatchesKey } from "../../common/keyboardUtils";
import { KeyCode } from "../../common/keys";

/** Returns whether the event is the notebook grid's plain Ctrl+C / Cmd+C shortcut. */
export function isNotebookCopyShortcut(
    event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): boolean {
    // Key matching is case-insensitive and may use physical keys for Option characters.
    // Reject extra modifiers so those distinct shortcuts do not copy the selection.
    return (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        eventMatchesKey(event, { key: "c", code: KeyCode.KeyC })
    );
}

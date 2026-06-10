/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FluentResultGridKeyBinding,
    FluentResultGridKeyCombination,
} from "../types/fluentResultGridCommands";

function isStructuredKeyCombination(
    keyCombination: FluentResultGridKeyBinding["keyCombination"] | undefined,
): keyCombination is FluentResultGridKeyCombination {
    return typeof keyCombination === "object" && keyCombination !== null;
}

export function fluentResultGridEventMatchesShortcut(
    event: KeyboardEvent,
    keyBinding: FluentResultGridKeyBinding | undefined,
): boolean {
    const combo = keyBinding?.keyCombination;
    if (!isStructuredKeyCombination(combo)) {
        return false;
    }

    if ((combo.ctrlKey ?? false) !== event.ctrlKey) {
        return false;
    }

    if ((combo.metaKey ?? false) !== event.metaKey) {
        return false;
    }

    if ((combo.altKey ?? false) !== event.altKey) {
        return false;
    }

    if ((combo.shiftKey ?? false) !== event.shiftKey) {
        return false;
    }

    if (combo.code) {
        return combo.code === event.code;
    }

    if (combo.key) {
        const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const comboKey = combo.key.length === 1 ? combo.key.toLowerCase() : combo.key;
        return eventKey === comboKey;
    }

    return false;
}

export function isFluentResultGridMetaOrCtrlKeyPressed(event: KeyboardEvent): boolean {
    return navigator.platform.toUpperCase().indexOf("MAC") >= 0 ? event.metaKey : event.ctrlKey;
}

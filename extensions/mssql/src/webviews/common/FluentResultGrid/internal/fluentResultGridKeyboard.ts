/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FluentResultGridKeyBindingMap,
    FluentResultGridKeyBinding,
    FluentResultGridKeyCombination,
} from "../types/fluentResultGridCommands";
import {
    FluentResultGridCommand,
    type FluentResultGridBuiltInCommandId,
} from "../types/fluentResultGridCommandIds";

export type FluentResultGridKeyboardShortcutEvent = Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export type FluentResultGridKeyboardAction =
    | {
          kind: "command";
          commandId: FluentResultGridBuiltInCommandId;
      }
    | { kind: "moveFocus"; forward: boolean }
    | { kind: "openColumnMenu" };

function isStructuredKeyCombination(
    keyCombination: FluentResultGridKeyBinding["keyCombination"] | undefined,
): keyCombination is FluentResultGridKeyCombination {
    return typeof keyCombination === "object" && keyCombination !== null;
}

export function fluentResultGridEventMatchesShortcut(
    event: FluentResultGridKeyboardShortcutEvent,
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

export function isFluentResultGridMetaOrCtrlKeyPressed(
    event: FluentResultGridKeyboardShortcutEvent,
): boolean {
    const platform = typeof navigator === "undefined" ? "" : navigator.platform;
    return platform.toUpperCase().indexOf("MAC") >= 0 ? event.metaKey : event.ctrlKey;
}

function eventMatchesCommandShortcut(
    event: FluentResultGridKeyboardShortcutEvent,
    keyBindings: FluentResultGridKeyBindingMap,
    commandId: FluentResultGridBuiltInCommandId,
): boolean {
    return fluentResultGridEventMatchesShortcut(event, keyBindings[commandId]);
}

export function getFluentResultGridKeyboardAction(
    event: FluentResultGridKeyboardShortcutEvent,
    keyBindings: FluentResultGridKeyBindingMap,
): FluentResultGridKeyboardAction | undefined {
    const shortcutOnlyCommands = [
        FluentResultGridCommand.CopySelection,
        FluentResultGridCommand.CopyWithHeaders,
        FluentResultGridCommand.CopyHeaders,
        FluentResultGridCommand.CopyAsCsv,
        FluentResultGridCommand.CopyAsJson,
        FluentResultGridCommand.CopyAsInsertInto,
        FluentResultGridCommand.CopyAsInClause,
        FluentResultGridCommand.SaveAsJson,
        FluentResultGridCommand.SaveAsCsv,
        FluentResultGridCommand.SaveAsExcel,
        FluentResultGridCommand.SaveAsInsert,
    ] as const;

    for (const commandId of shortcutOnlyCommands) {
        if (eventMatchesCommandShortcut(event, keyBindings, commandId)) {
            return { kind: "command", commandId };
        }
    }

    if (
        eventMatchesCommandShortcut(event, keyBindings, FluentResultGridCommand.SelectAll) ||
        (isFluentResultGridMetaOrCtrlKeyPressed(event) && event.code === "KeyA")
    ) {
        return { kind: "command", commandId: FluentResultGridCommand.SelectAll };
    }

    if (
        eventMatchesCommandShortcut(
            event,
            keyBindings,
            FluentResultGridCommand.ExpandSelectionLeft,
        ) ||
        (event.shiftKey &&
            !isFluentResultGridMetaOrCtrlKeyPressed(event) &&
            event.code === "ArrowLeft")
    ) {
        return { kind: "command", commandId: FluentResultGridCommand.ExpandSelectionLeft };
    }

    if (
        eventMatchesCommandShortcut(
            event,
            keyBindings,
            FluentResultGridCommand.ExpandSelectionRight,
        ) ||
        (event.shiftKey &&
            !isFluentResultGridMetaOrCtrlKeyPressed(event) &&
            event.code === "ArrowRight")
    ) {
        return { kind: "command", commandId: FluentResultGridCommand.ExpandSelectionRight };
    }

    if (
        eventMatchesCommandShortcut(
            event,
            keyBindings,
            FluentResultGridCommand.ExpandSelectionUp,
        ) ||
        (event.shiftKey &&
            !isFluentResultGridMetaOrCtrlKeyPressed(event) &&
            event.code === "ArrowUp")
    ) {
        return { kind: "command", commandId: FluentResultGridCommand.ExpandSelectionUp };
    }

    if (
        eventMatchesCommandShortcut(
            event,
            keyBindings,
            FluentResultGridCommand.ExpandSelectionDown,
        ) ||
        (event.shiftKey &&
            !isFluentResultGridMetaOrCtrlKeyPressed(event) &&
            event.code === "ArrowDown")
    ) {
        return { kind: "command", commandId: FluentResultGridCommand.ExpandSelectionDown };
    }

    if (
        eventMatchesCommandShortcut(event, keyBindings, FluentResultGridCommand.OpenColumnMenu) ||
        (event.shiftKey && event.code === "F10") ||
        event.code === "ContextMenu"
    ) {
        return { kind: "openColumnMenu" };
    }

    const remainingCommands = [
        FluentResultGridCommand.OpenFilter,
        FluentResultGridCommand.MoveToRowStart,
        FluentResultGridCommand.MoveToRowEnd,
        FluentResultGridCommand.SelectColumn,
        FluentResultGridCommand.SelectRow,
        FluentResultGridCommand.ToggleSort,
    ] as const;

    for (const commandId of remainingCommands) {
        if (eventMatchesCommandShortcut(event, keyBindings, commandId)) {
            return { kind: "command", commandId };
        }
    }

    if (event.shiftKey && event.code === "Tab") {
        return { kind: "moveFocus", forward: false };
    }

    if (!event.shiftKey && event.code === "Tab") {
        return { kind: "moveFocus", forward: true };
    }

    return undefined;
}

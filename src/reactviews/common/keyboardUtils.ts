/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardEvent as ReactKeyBoardEvent } from "react";
import {
    WebviewKeyBinding,
    WebviewKeyCombination,
    WebviewKeyBindings,
    WebviewKeyBindingConfiguration,
    WebviewAction,
} from "../../sharedInterfaces/webview";
import { isMac } from "./utils";

type TokenHandler = (matcher: WebviewKeyCombination, displayTokens: string[]) => void;

type KeyResolution = {
    key: string;
    code?: string;
    display: string;
};

const modifierHandlers: Record<string, TokenHandler> = {
    ctrl: (matcher, displayTokens) => {
        matcher.ctrlKey = true;
        displayTokens.push("Ctrl");
    },
    control: (matcher, displayTokens) => {
        matcher.ctrlKey = true;
        displayTokens.push("Ctrl");
    },
    shift: (matcher, displayTokens) => {
        matcher.shiftKey = true;
        displayTokens.push("Shift");
    },
    alt: (matcher, displayTokens) => {
        matcher.altKey = true;
        displayTokens.push("Alt");
    },
    option: (matcher, displayTokens) => {
        matcher.altKey = true;
        displayTokens.push(isMac() ? "Option" : "Alt");
    },
    cmd: (matcher, displayTokens) => {
        matcher.metaKey = true;
        displayTokens.push(isMac() ? "⌘" : "Meta");
    },
    command: (matcher, displayTokens) => {
        matcher.metaKey = true;
        displayTokens.push(isMac() ? "⌘" : "Meta");
    },
    meta: (matcher, displayTokens) => {
        matcher.metaKey = true;
        displayTokens.push("Meta");
    },
    win: (matcher, displayTokens) => {
        matcher.metaKey = true;
        displayTokens.push("Win");
    },
    windows: (matcher, displayTokens) => {
        matcher.metaKey = true;
        displayTokens.push("Win");
    },
    ctrlcmd: (matcher, displayTokens) => {
        if (isMac()) {
            matcher.metaKey = true;
            displayTokens.push("⌘");
        } else {
            matcher.ctrlKey = true;
            displayTokens.push("Ctrl");
        }
    },
};

const specialKeyMap: Record<string, KeyResolution> = {
    enter: { key: "Enter", code: "Enter", display: "Enter" },
    return: { key: "Enter", code: "Enter", display: "Enter" },
    escape: { key: "Escape", code: "Escape", display: "Esc" },
    esc: { key: "Escape", code: "Escape", display: "Esc" },
    tab: { key: "Tab", code: "Tab", display: "Tab" },
    space: { key: " ", code: "Space", display: "Space" },
    spacebar: { key: " ", code: "Space", display: "Space" },
    backspace: { key: "Backspace", code: "Backspace", display: "Backspace" },
    delete: { key: "Delete", code: "Delete", display: "Delete" },
    del: { key: "Delete", code: "Delete", display: "Delete" },
    home: { key: "Home", code: "Home", display: "Home" },
    end: { key: "End", code: "End", display: "End" },
    pageup: { key: "PageUp", code: "PageUp", display: "PageUp" },
    pgup: { key: "PageUp", code: "PageUp", display: "PageUp" },
    pagedown: { key: "PageDown", code: "PageDown", display: "PageDown" },
    pgdn: { key: "PageDown", code: "PageDown", display: "PageDown" },
    up: { key: "ArrowUp", code: "ArrowUp", display: "Up" },
    arrowup: { key: "ArrowUp", code: "ArrowUp", display: "Up" },
    down: { key: "ArrowDown", code: "ArrowDown", display: "Down" },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", display: "Down" },
    left: { key: "ArrowLeft", code: "ArrowLeft", display: "Left" },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", display: "Left" },
    right: { key: "ArrowRight", code: "ArrowRight", display: "Right" },
    arrowright: { key: "ArrowRight", code: "ArrowRight", display: "Right" },
    comma: { key: ",", code: "Comma", display: "," },
    period: { key: ".", code: "Period", display: "." },
    dot: { key: ".", code: "Period", display: "." },
    slash: { key: "/", code: "Slash", display: "/" },
    forwardslash: { key: "/", code: "Slash", display: "/" },
    backslash: { key: "\\", code: "Backslash", display: "\\" },
    minus: { key: "-", code: "Minus", display: "-" },
    hyphen: { key: "-", code: "Minus", display: "-" },
    equal: { key: "=", code: "Equal", display: "=" },
    equals: { key: "=", code: "Equal", display: "=" },
    semicolon: { key: ";", code: "Semicolon", display: ";" },
    quote: { key: "'", code: "Quote", display: "'" },
    apostrophe: { key: "'", code: "Quote", display: "'" },
    backquote: { key: "`", code: "Backquote", display: "`" },
    backtick: { key: "`", code: "Backquote", display: "`" },
};

const FUNCTION_KEY_REGEX = /^f([1-9]|1[0-2])$/;

/**
 * Normalizes the raw keyboard shortcut string into tokens.
 * @param raw Raw keyboard shortcut string
 * @returns Array of normalized tokens
 */
function normalize(raw?: string): string[] {
    if (!raw) {
        return [];
    }
    return raw
        .split("+")
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0);
}

/**
 * Resolves a key token into its key, code, and display representation.
 * @param token Key token to resolve
 * @returns Resolved key information or undefined if not recognized
 */
function resolveKeyToken(token: string): KeyResolution | undefined {
    if (token.length === 1 && token >= "a" && token <= "z") {
        return {
            key: token,
            code: `Key${token.toUpperCase()}`,
            display: token.toUpperCase(),
        };
    }

    if (token.length === 1 && token >= "0" && token <= "9") {
        return {
            key: token,
            code: `Digit${token}`,
            display: token,
        };
    }

    if (FUNCTION_KEY_REGEX.test(token)) {
        const value = token.toUpperCase();
        return { key: value, code: value, display: value };
    }

    return specialKeyMap[token];
}

/**
 * Builds a webview shortcut from the given tokens.
 * @param tokens Tokens representing the keyboard shortcut
 * @returns Parsed webview shortcut or undefined if invalid
 */
function buildShortcut(tokens: string[]): WebviewKeyBinding | undefined {
    if (!tokens.length) {
        return undefined;
    }

    const matcher: WebviewKeyCombination = {};
    const displayTokens: string[] = [];
    let keyAssigned = false;

    for (const token of tokens) {
        const modifierHandler = modifierHandlers[token];
        if (modifierHandler) {
            modifierHandler(matcher, displayTokens);
            continue;
        }

        if (keyAssigned) {
            // Unsupported chord; only single primary key is handled.
            return undefined;
        }

        const keyInfo = resolveKeyToken(token);
        if (!keyInfo) {
            return undefined;
        }

        matcher.key = keyInfo.key;
        if (keyInfo.code) {
            matcher.code = keyInfo.code;
        }
        displayTokens.push(keyInfo.display);
        keyAssigned = true;
    }

    if (!keyAssigned) {
        return undefined;
    }

    return { keyCombination: matcher, label: displayTokens.join("+") };
}

/**
 * Gets the shortcut information from the raw keyboard shortcut string.
 * @param raw Raw keyboard shortcut string from configuration
 * @returns Parsed webview shortcut
 */
export function getShortcutInfo(raw: string | undefined): WebviewKeyBinding {
    const primaryTokens = normalize(raw);
    const primary = buildShortcut(primaryTokens);
    if (primary) {
        return primary;
    }

    return { keyCombination: {}, label: "" };
}

function getDefaultConfig(): WebviewKeyBindingConfiguration {
    return {
        [WebviewAction.ResultGridSelectAll]: "ctrlcmd+a",
        [WebviewAction.ResultGridCopySelection]: "ctrlcmd+c",
    } as WebviewKeyBindingConfiguration;
}

/**
 * Parses the webview keyboard shortcut configuration into shortcut information.
 * @param config Keyboard shortcut configuration
 * @returns Parsed webview shortcuts
 */
export function parseWebviewKeyboardShortcutConfig(
    config: WebviewKeyBindingConfiguration,
): WebviewKeyBindings {
    const webviewKeyBinding = {} as WebviewKeyBindings;
    config = { ...getDefaultConfig(), ...config };
    Object.keys(config).forEach((key) => {
        const keyType = key as WebviewAction;
        webviewKeyBinding[keyType] = getShortcutInfo(
            config[key as keyof WebviewKeyBindingConfiguration],
        );
    });
    return webviewKeyBinding;
}

/**
 * Matches a raw keyboard event against the event generated from user configuration.
 * @param event Raw keyboard event
 * @param keyCombination parsed key combination from user configuration
 * @returns True if the event matches the configuration, false otherwise
 */
export function eventMatchesShortcut(
    event: KeyboardEvent | ReactKeyBoardEvent<any>,
    combo: WebviewKeyCombination,
): boolean {
    if (!combo) return false;

    // Treat undefined modifier as not pressed.
    if ((combo.ctrlKey ?? false) !== event.ctrlKey) return false;
    if ((combo.metaKey ?? false) !== event.metaKey) return false;
    if ((combo.altKey ?? false) !== event.altKey) return false;
    if ((combo.shiftKey ?? false) !== event.shiftKey) return false;

    // If a code is provided, it must match.
    if (combo.code) {
        return combo.code === event.code;
    }

    // Otherwise match by `key` if provided.
    if (combo.key) {
        const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const comboKey = combo.key.length === 1 ? combo.key.toLowerCase() : combo.key;
        return eventKey === comboKey;
    }

    // If neither code nor key specified, we can't match.
    return false;
}

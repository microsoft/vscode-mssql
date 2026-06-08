/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMac } from "../../common/utils";
import { makeStyles } from "@fluentui/react-components";

const modifierKeys = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "Tab", "Escape"]);

function normalizeRecordedKey(event: KeyboardEvent): string {
    const codeMap: Record<string, string> = {
        Comma: "comma",
        Period: "period",
        Slash: "slash",
        Backslash: "backslash",
        Minus: "minus",
        Equal: "equal",
        Semicolon: "semicolon",
        Quote: "quote",
        Backquote: "backquote",
        BracketLeft: "bracketleft",
        BracketRight: "bracketright",
    };
    if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3).toLowerCase();
    }
    if (/^Digit[0-9]$/.test(event.code)) {
        return event.code.slice(5);
    }
    if (codeMap[event.code]) {
        return codeMap[event.code];
    }

    const specialKeyMap: Record<string, string> = {
        " ": "space",
        ",": "comma",
        ".": "period",
        "/": "slash",
        "\\": "backslash",
        "-": "minus",
        "=": "equal",
        ";": "semicolon",
        "'": "quote",
        "`": "backquote",
        "[": "bracketleft",
        "]": "bracketright",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Escape: "escape",
        Enter: "enter",
        Tab: "tab",
        Backspace: "backspace",
        Delete: "delete",
        PageUp: "pageup",
        PageDown: "pagedown",
    };

    return specialKeyMap[event.key] ?? event.key.toLowerCase();
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
    if (modifierKeys.has(event.key)) {
        return undefined;
    }

    const parts: string[] = [];
    if (event.ctrlKey) {
        parts.push("ctrl");
    }
    if (event.metaKey) {
        parts.push("cmd");
    }
    if (event.altKey) {
        parts.push("alt");
    }
    if (event.shiftKey) {
        parts.push("shift");
    }
    parts.push(normalizeRecordedKey(event));
    return parts.join("+");
}

export function formatShortcut(value: string | undefined): string {
    if (!value?.trim()) {
        return "";
    }

    return value
        .split("+")
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((token) => {
            const lower = token.toLowerCase();
            const tokenMap: Record<string, string> = {
                ctrl: "Ctrl",
                control: "Ctrl",
                ctrlcmd: isMac() ? "Cmd" : "Ctrl",
                cmd: "Cmd",
                command: "Cmd",
                meta: isMac() ? "Cmd" : "Meta",
                alt: "Alt",
                option: "Alt",
                shift: "Shift",
                up: "Up",
                down: "Down",
                left: "Left",
                right: "Right",
                pageup: "PageUp",
                pagedown: "PageDown",
                space: "Space",
                escape: "Esc",
                comma: ",",
                period: ".",
                dot: ".",
                slash: "/",
                forwardslash: "/",
                backslash: "\\",
                minus: "-",
                hyphen: "-",
                equal: "=",
                equals: "=",
                semicolon: ";",
                quote: "'",
                apostrophe: "'",
                backquote: "`",
                backtick: "`",
                bracketleft: "[",
                leftbracket: "[",
                bracketright: "]",
                rightbracket: "]",
            };
            return tokenMap[lower] ?? (lower.length === 1 ? lower.toUpperCase() : token);
        })
        .join("+");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textMatchesSearch(text: string, searchTerm: string): boolean {
    return text.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase());
}

const useHighlightedTextStyles = makeStyles({
    match: {
        backgroundColor:
            "var(--vscode-editor-findMatchHighlightBackground, rgba(255, 196, 0, 0.35))",
        borderRadius: "2px",
        color: "inherit",
        padding: "0 1px",
    },
});

export const HighlightedText = ({ text, searchTerm }: { text: string; searchTerm: string }) => {
    const classes = useHighlightedTextStyles();
    const term = searchTerm.trim();
    if (!term) {
        return <>{text}</>;
    }

    const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "gi"));
    return (
        <>
            {parts.map((part, index) =>
                part.toLocaleLowerCase() === term.toLocaleLowerCase() ? (
                    <mark key={`${part}-${index}`} className={classes.match}>
                        {part}
                    </mark>
                ) : (
                    <span key={`${part}-${index}`}>{part}</span>
                ),
            )}
        </>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    ColorThemeKind,
    CoreRPCs,
    LoggerLevel,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../sharedInterfaces/webview";
import { WebviewRpc } from "./rpc";
import { VscodeWebviewContext } from "./vscodeWebviewProvider";

/**
 * Format a string. Behaves like C#'s string.Format() function.
 */
export function formatString(str: string, ...args: any[]): string {
    // This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
    // License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
    let result: string;
    if (args.length === 0) {
        result = str;
    } else {
        result = str.replace(/\{(\d+)\}/g, (match, rest) => {
            let index = rest[0];
            return typeof args[index] !== "undefined" ? args[index] : match;
        });
    }
    return result;
}

/**
 * Get the css string representation of a ColorThemeKind
 * @param themeKind The ColorThemeKind to convert
 */
export function resolveVscodeThemeType(themeKind: ColorThemeKind): string {
    switch (themeKind) {
        case ColorThemeKind.Dark:
            return "vs-dark";
        case ColorThemeKind.HighContrast:
            return "hc-black";
        default: // Both hc-light and light themes are treated as light.
            return "light";
    }
}

export function themeType(themeKind: ColorThemeKind): string {
    const themeType = resolveVscodeThemeType(themeKind);
    if (themeType === "vs-dark") {
        return "dark";
    } else if (themeType === "hc-black") {
        return "highContrast";
    }
    return themeType;
}

/** Removes duplicate values from an array */
export function removeDuplicates<T>(array: T[]): T[] {
    return Array.from(new Set(array));
}

/** from vscode: https://github.com/microsoft/vscode/blob/5bd3d12fb18047ae33ac4b171dee3cd044b6f3d4/src/vs/base/common/objects.ts#L8 */
export function deepClone<T>(obj: T): T {
    if (!obj || typeof obj !== "object") {
        return obj;
    }
    if (obj instanceof RegExp) {
        return obj;
    }
    const result: any = Array.isArray(obj) ? [] : {};
    Object.entries(obj).forEach(([key, value]) => {
        result[key] = value && typeof value === "object" ? deepClone(value) : value;
    });
    return result;
}

export function getCoreRPCs<TState, TReducers>(
    webviewContext: VscodeWebviewContext<TState, TReducers>,
): CoreRPCs {
    return getCoreRPCs2(webviewContext.extensionRpc);
}

export function getCoreRPCs2<TReducers>(extensionRpc: WebviewRpc<TReducers>): CoreRPCs {
    return {
        log(message: string, level?: LoggerLevel) {
            extensionRpc.log(message, level);
        },
        sendActionEvent(event: WebviewTelemetryActionEvent) {
            extensionRpc.sendActionEvent(event);
        },
        sendErrorEvent(event: WebviewTelemetryErrorEvent) {
            extensionRpc.sendErrorEvent(event);
        },
    };
}

export enum MouseButton {
    LeftClick = 0,
    Middle = 1,
    RightClick = 2,
}

/**
 * Get the end of line character(s) based on the user's OS.
 */
export function getEOL(): string {
    var linebreaks = {
        Windows: "\r\n",
        Mac: "\n",
        Linux: "\n",
    };
    for (const key in linebreaks) {
        if (navigator.userAgent.indexOf(key) != -1) {
            return linebreaks[key as keyof typeof linebreaks];
        }
    }
    return "\n";
}

/**
 * Checks if the current platform is Mac.
 * @returns True if the platform is Mac, false otherwise.
 */
export function isMac(): boolean {
    return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
}

/**
 * Checks if the meta key is pressed based on the user's OS.
 * @param e The keyboard or mouse event to check.
 * @returns True if the meta key is pressed, false otherwise.
 */
export function isMetaKeyPressed(e: KeyboardEvent | MouseEvent | React.KeyboardEvent): boolean {
    return isMac() ? e.metaKey : e.ctrlKey;
}

// Shared focusable selector (slightly generalized)
const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button",
    "textarea",
    'input:not([type="hidden"])',
    "select",
    "[tabindex]",
    '[contenteditable="true"]',
]
    .map((s) => `${s}:not([tabindex="-1"])`)
    .join(",");

function isElementVisible(el: HTMLElement): boolean {
    // Covers display:none/visibility:hidden/off-screen containers, etc.
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;

    // offsetParent check misses fixed/absolute in some cases; getClientRects covers that
    if (el.offsetParent === null && el.getClientRects().length === 0) return false;

    return true;
}

function getFocusableElements(root: ParentNode = document): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && isElementVisible(el),
    );
}

function getAdjacentFocusableElement(
    currentElement: HTMLElement,
    step: 1 | -1,
    root: ParentNode = document,
): HTMLElement | null {
    const focusable = getFocusableElements(root);
    if (focusable.length === 0) return null;

    const idx = focusable.indexOf(currentElement);
    if (idx === -1) return null;

    const nextIdx = (idx + step + focusable.length) % focusable.length;
    return focusable[nextIdx] ?? null;
}

/**
 * Get the next focusable element.
 * @param currentElement The current focused element.
 * @param root The root element to limit the search within. If not provided, document is used.
 * @returns The next focusable element, or null if none found.
 */
export function getNextFocusableElement(
    currentElement: HTMLElement,
    root?: ParentNode,
): HTMLElement | null {
    return getAdjacentFocusableElement(currentElement, 1, root ?? document);
}

/**
 * Get the previous focusable element.
 * @param currentElement The current focused element.
 * @param root The root element to limit the search within. If not provided, document is used.
 * @returns The previous focusable element, or null if none found.
 */
export function getPreviousFocusableElement(
    currentElement: HTMLElement,
    root?: ParentNode,
): HTMLElement | null {
    return getAdjacentFocusableElement(currentElement, -1, root ?? document);
}

/**
 * Get the next focusable element outside the given container.
 * @param container The container element to check against.
 * @returns The next focusable element outside the container, or null if none found.
 */
export function getNextFocusableElementOutside(container: HTMLElement): HTMLElement | null {
    const focusables = getFocusableElements();
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;

    const currentIndex = focusables.findIndex((el) => el === active && container.contains(el));
    if (currentIndex === -1) return null;

    for (let i = currentIndex + 1; i < focusables.length; i++) {
        const el = focusables[i];
        if (!container.contains(el)) {
            el.focus();
            return el;
        }
    }
    return null; // no next element outside the container
}

/**
 * Get the previous focusable element outside the given container.
 * @param container The container element to check against.
 * @returns The previous focusable element outside the container, or null if none found.
 */
export function getPreviousFocusableElementOutside(container: HTMLElement): HTMLElement | null {
    const focusables = getFocusableElements();
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;

    const currentIndex = focusables.findIndex((el) => el === active && container.contains(el));
    if (currentIndex === -1) return null;
    for (let i = currentIndex - 1; i >= 0; i--) {
        const el = focusables[i];
        if (!container.contains(el)) {
            el.focus();
            return el;
        }
    }
    return null; // no previous element outside the container
}

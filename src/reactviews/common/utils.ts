/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ColorThemeKind,
    CoreRPCs,
    GetPlatformRequest,
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

export async function isMac(): Promise<boolean> {
    const platform = await WebviewRpc.getInstance(undefined!).sendRequest(GetPlatformRequest.type);
    return platform === "darwin";
}

export async function isMetaKeyPressed(e: KeyboardEvent | MouseEvent): Promise<boolean> {
    return (await isMac()) ? e.metaKey : e.ctrlKey;
}

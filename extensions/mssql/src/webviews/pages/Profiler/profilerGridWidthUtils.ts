/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const PROFILER_HEADER_TEXT_PADDING_PX = 12;
export const PROFILER_HEADER_BUTTONS_WIDTH_PX = 40;
export const PROFILER_HEADER_EXTRA_WIDTH_PX = 10;
export const PROFILER_HEADER_FALLBACK_CHAR_WIDTH_PX = 8;
export const PROFILER_RESIZABLE_MIN_WIDTH_PX = 50;

export interface ProfilerColumnWidthOptions {
    hasHeaderButtons?: boolean;
    measureText?: (text: string) => number;
}

function defaultMeasureText(text: string): number {
    if (typeof document === "undefined") {
        return text.length * PROFILER_HEADER_FALLBACK_CHAR_WIDTH_PX;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
        return text.length * PROFILER_HEADER_FALLBACK_CHAR_WIDTH_PX;
    }

    const computedStyle = window.getComputedStyle(document.body);
    const fontSize = computedStyle.getPropertyValue("font-size") || "13px";
    const fontFamily = computedStyle.getPropertyValue("font-family") || "var(--vscode-font-family)";
    const fontWeight = computedStyle.getPropertyValue("font-weight") || "400";

    context.font = `${fontWeight} ${fontSize} ${fontFamily}`;
    return context.measureText(text).width;
}

export function getProfilerColumnDefaultWidth(
    headerText: string,
    options: ProfilerColumnWidthOptions = {},
): number {
    const measureText = options.measureText ?? defaultMeasureText;
    const headerButtonsWidth =
        options.hasHeaderButtons === false ? 0 : PROFILER_HEADER_BUTTONS_WIDTH_PX;

    return Math.ceil(
        measureText(headerText) +
            PROFILER_HEADER_TEXT_PADDING_PX +
            headerButtonsWidth +
            PROFILER_HEADER_EXTRA_WIDTH_PX,
    );
}

export function getProfilerColumnWidth(
    headerText: string,
    requestedWidth: number | undefined,
    options: ProfilerColumnWidthOptions = {},
): number {
    const defaultWidth = getProfilerColumnDefaultWidth(headerText, options);
    return requestedWidth === undefined ? defaultWidth : Math.max(requestedWidth, defaultWidth);
}

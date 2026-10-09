/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryStoreSettings,
    QueryStoreSettingsChange,
} from "../../../sharedInterfaces/performance";

/** The choices of the Query Store settings form. The current value is added when it differs. */
export const maxSizeChoicesMb: readonly number[] = [1024, 2048, 4096];
export const keepDaysChoices: readonly number[] = [14, 30, 60];
export const intervalChoicesMinutes: readonly number[] = [5, 15, 60];

/** Query Store starts size-based cleanup at this percent of the maximum size. */
export const cleanupThresholdPercent = 90;

export type OperationModeChoice = "off" | "readWrite" | "readOnly";

/** The values of the form. A value equal to the current setting changes nothing. */
export interface QueryStoreSettingsForm {
    readonly operationMode: OperationModeChoice;
    readonly captureMode?: QueryStoreSettings["captureMode"];
    readonly maxStorageMb?: number;
    readonly staleQueryThresholdDays?: number;
    readonly intervalLengthMinutes?: number;
    readonly waitStatsCapture?: "on" | "off";
}

/** The choices of a number setting: the presets and the current value, in order. */
export function numberChoices(presets: readonly number[], current: number | undefined): number[] {
    const values = new Set(presets);
    if (current !== undefined) {
        values.add(current);
    }
    return [...values].sort((left, right) => left - right);
}

/** The operation mode as the form shows it. Error and secondary capture show as read-write. */
export function operationModeOf(settings: QueryStoreSettings): OperationModeChoice {
    switch (settings.actualState) {
        case "off":
            return "off";
        case "readOnly":
            return "readOnly";
        default:
            return "readWrite";
    }
}

/** A form with the current settings. */
export function formOf(settings: QueryStoreSettings): QueryStoreSettingsForm {
    return {
        operationMode: operationModeOf(settings),
        captureMode: settings.captureMode,
        maxStorageMb: settings.maxStorageMb,
        staleQueryThresholdDays: settings.staleQueryThresholdDays,
        intervalLengthMinutes: settings.intervalLengthMinutes,
        waitStatsCapture: settings.waitStatsCapture,
    };
}

/**
 * The change of a form: only the values that differ from the settings. A custom capture mode
 * cannot be set here, so it is left out.
 */
export function changeOf(
    form: QueryStoreSettingsForm,
    settings: QueryStoreSettings,
): QueryStoreSettingsChange {
    const current = formOf(settings);
    const change: { -readonly [K in keyof QueryStoreSettingsChange]: QueryStoreSettingsChange[K] } =
        {};
    if (form.operationMode !== current.operationMode && form.operationMode !== "off") {
        change.operationMode = form.operationMode;
    }
    if (
        form.captureMode !== current.captureMode &&
        form.captureMode !== undefined &&
        form.captureMode !== "custom"
    ) {
        change.captureMode = form.captureMode;
    }
    if (form.maxStorageMb !== current.maxStorageMb) {
        change.maxStorageMb = form.maxStorageMb;
    }
    if (form.staleQueryThresholdDays !== current.staleQueryThresholdDays) {
        change.staleQueryThresholdDays = form.staleQueryThresholdDays;
    }
    if (form.intervalLengthMinutes !== current.intervalLengthMinutes) {
        change.intervalLengthMinutes = form.intervalLengthMinutes;
    }
    if (form.waitStatsCapture !== current.waitStatsCapture) {
        change.waitStatsCapture = form.waitStatsCapture;
    }
    return change;
}

export interface StorageUse {
    readonly usedMb: number;
    readonly maxMb: number;
    /** 0 to 100. */
    readonly percent: number;
    /** Set when size-based cleanup is on. */
    readonly cleanupPercent?: number;
}

/** The storage use of Query Store, or undefined without the sizes. */
export function storageUseOf(settings: QueryStoreSettings): StorageUse | undefined {
    const { currentStorageMb: usedMb, maxStorageMb: maxMb } = settings;
    if (usedMb === undefined || maxMb === undefined || maxMb <= 0) {
        return undefined;
    }
    return {
        usedMb,
        maxMb,
        percent: Math.min(100, Math.max(0, (usedMb / maxMb) * 100)),
        ...(settings.sizeBasedCleanup === "auto"
            ? { cleanupPercent: cleanupThresholdPercent }
            : {}),
    };
}

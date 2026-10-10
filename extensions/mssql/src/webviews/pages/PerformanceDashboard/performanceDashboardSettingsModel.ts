/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryStoreCapturePolicy,
    QueryStoreSettings,
    QueryStoreSettingsChange,
} from "../../../sharedInterfaces/performance";

/** The values of `INTERVAL_LENGTH_MINUTES` that SQL Server accepts. */
export const intervalChoicesMinutes: readonly number[] = [1, 5, 10, 15, 30, 60, 1440];

/** The limits of the number settings, as SQL Server accepts them. */
export const maxWholeNumber = 2_147_483_647;
export const maxKeepDays = 36_500;
export const maxFlushMinutes = Math.floor(maxWholeNumber / 60);
/** `STALE_CAPTURE_POLICY_THRESHOLD` is from 1 hour to 7 days. */
export const maxCaptureStaleHours = 168;

/** The custom capture policy of SQL Server when a database has none yet. */
export const defaultCapturePolicy: QueryStoreCapturePolicy = {
    staleThresholdHours: 24,
    executionCount: 30,
    totalCompileCpuTimeMs: 1000,
    totalExecutionCpuTimeMs: 100,
};

/** Query Store starts size-based cleanup at this percent of the maximum size. */
export const cleanupThresholdPercent = 90;

export type OperationModeChoice = "off" | "readWrite" | "readOnly";

/** The values of the form. A value equal to the current setting changes nothing. */
export interface QueryStoreSettingsForm {
    readonly operationMode: OperationModeChoice;
    readonly captureMode?: QueryStoreSettings["captureMode"];
    readonly capturePolicy?: QueryStoreCapturePolicy;
    readonly maxStorageMb?: number;
    readonly sizeBasedCleanup?: "auto" | "off";
    readonly staleQueryThresholdDays?: number;
    readonly flushIntervalSeconds?: number;
    readonly intervalLengthMinutes?: number;
    readonly waitStatsCapture?: "on" | "off";
}

/** The choices of a setting with a list of values: the list and the current value, in order. */
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
        capturePolicy: settings.capturePolicy,
        maxStorageMb: settings.maxStorageMb,
        sizeBasedCleanup: settings.sizeBasedCleanup,
        staleQueryThresholdDays: settings.staleQueryThresholdDays,
        flushIntervalSeconds: settings.flushIntervalSeconds,
        intervalLengthMinutes: settings.intervalLengthMinutes,
        waitStatsCapture: settings.waitStatsCapture,
    };
}

/**
 * True when the form turns Query Store off. Off is a change of its own: the other values do not
 * apply, so the form leaves them as they are.
 */
export function turnsOff(form: QueryStoreSettingsForm, settings: QueryStoreSettings): boolean {
    return form.operationMode === "off" && operationModeOf(settings) !== "off";
}

/** The change of a form: only the values that differ from the settings. */
export function changeOf(
    form: QueryStoreSettingsForm,
    settings: QueryStoreSettings,
): QueryStoreSettingsChange {
    if (turnsOff(form, settings)) {
        return { operationMode: "off" };
    }
    const current = formOf(settings);
    const change: { -readonly [K in keyof QueryStoreSettingsChange]: QueryStoreSettingsChange[K] } =
        {};
    if (form.operationMode !== current.operationMode && form.operationMode !== "off") {
        change.operationMode = form.operationMode;
    }
    if (form.captureMode === "custom") {
        // A form without a policy keeps the current one, or uses the defaults of a new custom mode.
        const policy = form.capturePolicy ?? current.capturePolicy ?? defaultCapturePolicy;
        const policyChanged =
            form.capturePolicy !== undefined &&
            JSON.stringify(form.capturePolicy) !== JSON.stringify(current.capturePolicy);
        if (current.captureMode !== "custom" || policyChanged) {
            change.captureMode = "custom";
            change.capturePolicy = policy;
        }
    } else if (form.captureMode !== current.captureMode && form.captureMode !== undefined) {
        change.captureMode = form.captureMode;
    }
    if (form.maxStorageMb !== current.maxStorageMb) {
        change.maxStorageMb = form.maxStorageMb;
    }
    if (form.sizeBasedCleanup !== current.sizeBasedCleanup) {
        change.sizeBasedCleanup = form.sizeBasedCleanup;
    }
    if (form.staleQueryThresholdDays !== current.staleQueryThresholdDays) {
        change.staleQueryThresholdDays = form.staleQueryThresholdDays;
    }
    if (form.flushIntervalSeconds !== current.flushIntervalSeconds) {
        change.flushIntervalSeconds = form.flushIntervalSeconds;
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

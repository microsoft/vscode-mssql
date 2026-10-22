/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Effective-settings capture: emits a feature's configuration surface as a
 * classified kind:"state" DiagEvent (settings.snapshot / settings.changed) so
 * captured sessions record WHICH knobs were on — the piece of the completions
 * branch's "settings capture" that belongs on the common substrate. Rich
 * per-request settings (overrides applied to one completion) stay in the
 * feature capture store; this is the ambient config baseline.
 *
 * Classification rules (privacy):
 * - keys matching the secret pattern are ALWAYS classified "secret"
 *   (tokenized, never plaintext) — a spec cannot loosen this;
 * - booleans/numbers default to "diagnostic.metadata" (plain);
 * - strings default to "user.text" (redacted under the default policy) unless
 *   the spec explicitly declares a safer class for a known-enum key.
 */

import * as vscode from "vscode";
import { diag } from "../diagnosticsCore";
import { DataClassification } from "../../sharedInterfaces/debugConsole";

export interface FeatureSettingsKeySpec {
    /** Full setting id, e.g. "mssql.copilot.inlineCompletions.debounceMs". */
    key: string;
    /**
     * Explicit classification for string values (e.g. "diagnostic.metadata"
     * for closed enums, "source.path" for folders). Ignored for secret-pattern
     * keys, which are always "secret".
     */
    cls?: DataClassification;
}

export interface FeatureSettingsSpec {
    /** Feature bucket stamped on the event (settingsFeature attr), e.g. "completions". */
    feature: string;
    keys: Array<string | FeatureSettingsKeySpec>;
}

export type SettingsSnapshotReason = "captureArmed" | "panelOpened" | "configChanged" | "manual";

const SECRET_KEY_PATTERN = /apikey|api-key|token|secret|password|credential/i;

export function emitSettingsSnapshot(
    spec: FeatureSettingsSpec,
    reason: SettingsSnapshotReason,
): void {
    emitSettingsEvent(spec, normalizeKeys(spec.keys), "settings.snapshot", reason);
}

/**
 * Watch the spec's keys and re-emit deltas while the subscription lives.
 * Returns a disposable; registration is cheap and emission no-ops without
 * active sinks.
 */
export function watchFeatureSettings(spec: FeatureSettingsSpec): vscode.Disposable {
    const keys = normalizeKeys(spec.keys);
    return vscode.workspace.onDidChangeConfiguration((event) => {
        const changed = keys.filter((keySpec) => event.affectsConfiguration(keySpec.key));
        if (changed.length === 0) {
            return;
        }

        emitSettingsEvent(spec, changed, "settings.changed", "configChanged");
    });
}

function emitSettingsEvent(
    spec: FeatureSettingsSpec,
    keys: FeatureSettingsKeySpec[],
    type: "settings.snapshot" | "settings.changed",
    reason: SettingsSnapshotReason,
): void {
    const configuration = vscode.workspace.getConfiguration();
    const fields: Record<string, { raw: unknown; cls: DataClassification }> = {
        settingsFeature: { raw: spec.feature, cls: "diagnostic.metadata" },
        keyCount: { raw: keys.length, cls: "diagnostic.metadata" },
        reason: { raw: reason, cls: "diagnostic.metadata" },
    };
    for (const keySpec of keys) {
        const value = configuration.get(keySpec.key);
        if (value === undefined) {
            continue;
        }

        fields[keySpec.key] = {
            raw: serializeSettingValue(value),
            cls: classifySettingValue(keySpec, value),
        };
    }

    diag.emit({
        feature: "diagnostics",
        kind: "state",
        type,
        fields,
    });
}

function normalizeKeys(keys: Array<string | FeatureSettingsKeySpec>): FeatureSettingsKeySpec[] {
    return keys.map((key) => (typeof key === "string" ? { key } : key));
}

/** Exported for tests and for features that pre-classify values themselves. */
export function classifySettingValue(
    keySpec: FeatureSettingsKeySpec,
    value: unknown,
): DataClassification {
    if (SECRET_KEY_PATTERN.test(keySpec.key)) {
        return "secret";
    }

    if (keySpec.cls) {
        return keySpec.cls;
    }

    if (typeof value === "boolean" || typeof value === "number") {
        return "diagnostic.metadata";
    }

    return "user.text";
}

function serializeSettingValue(value: unknown): string | number | boolean {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

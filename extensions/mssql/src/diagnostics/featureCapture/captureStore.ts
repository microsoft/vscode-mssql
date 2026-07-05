/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic per-feature capture store: a bounded in-memory ring of rich feature
 * events (completions requests, Query Studio run records, ...) with a
 * pending→final update lifecycle, session-only settings overrides, and
 * panel-open/record-when-closed capture gating.
 *
 * This store deliberately lives OUTSIDE the diag substrate: feature events may
 * carry payloads (prompts, SQL text under elevated capture) that must never
 * ride DiagEvents. Persistence goes through traceCodec/traceFiles, which apply
 * the feature's redaction rules on the way out.
 */

import * as vscode from "vscode";
import { logger2 } from "../../models/logger2";

export interface FeatureCaptureEventBase {
    id: string;
    timestamp: number;
}

export interface FeatureCaptureStoreOptions<TEvent extends FeatureCaptureEventBase, TOverrides> {
    /** Log prefix, e.g. "InlineCompletionDebug". */
    logName: string;
    /** Ring capacity; oldest events are trimmed past this. */
    capacity?: number;
    /** Event id prefix; ids are `${idPrefix}-${counter}`. */
    idPrefix?: string;
    defaultOverrides: TOverrides;
    /** Full normalization applied on replace/import. */
    normalizeOverrides: (overrides: Partial<TOverrides>) => TOverrides;
    /** Per-present-key normalization applied on partial update. */
    normalizePartialOverrides: (overrides: Partial<TOverrides>) => Partial<TOverrides>;
    /** Optional migration hook for overrides read from imported files. */
    normalizeImportedOverrides?: (overrides: TOverrides | undefined) => TOverrides | undefined;
    /** Optional per-event fixup applied to imported events (defensive clones). */
    prepareImportedEvent?: (event: TEvent) => TEvent;
}

export const DEFAULT_FEATURE_CAPTURE_CAPACITY = 500;

export class FeatureCaptureStore<TEvent extends FeatureCaptureEventBase, TOverrides> {
    private readonly _logger;
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _capacity: number;
    private readonly _idPrefix: string;
    private readonly _options: FeatureCaptureStoreOptions<TEvent, TOverrides>;
    private _events: TEvent[] = [];
    private _overrides: TOverrides;
    private _eventCounter = 0;
    private _panelOpen = false;

    public readonly onDidChange;

    constructor(options: FeatureCaptureStoreOptions<TEvent, TOverrides>) {
        this._options = options;
        this._logger = logger2.withPrefix(options.logName);
        this._capacity = options.capacity ?? DEFAULT_FEATURE_CAPTURE_CAPACITY;
        this._idPrefix = options.idPrefix ?? "E";
        this._overrides = options.normalizeOverrides({ ...options.defaultOverrides });
        this.onDidChange = this._onDidChange.event;
    }

    public getOverrides(): TOverrides {
        return { ...this._overrides };
    }

    public updateOverrides(overrides: Partial<TOverrides>): void {
        this._overrides = {
            ...this._overrides,
            ...this._options.normalizePartialOverrides(overrides),
        };
        this._onDidChange.fire();
    }

    public replaceOverrides(overrides: TOverrides): void {
        this._overrides = this._options.normalizeOverrides(overrides);
        this._onDidChange.fire();
    }

    public getEvents(): TEvent[] {
        return [...this._events];
    }

    public getEvent(eventId: string): TEvent | undefined {
        return this._events.find((event) => event.id === eventId);
    }

    public addEvent(event: Omit<TEvent, "id">): TEvent {
        const storedEvent = {
            ...event,
            id: `${this._idPrefix}-${++this._eventCounter}`,
        } as TEvent;

        this._events.push(storedEvent);
        if (this._events.length > this._capacity) {
            this._events.splice(0, this._events.length - this._capacity);
        }

        this._onDidChange.fire();
        return storedEvent;
    }

    public updateEvent(eventId: string, event: Omit<TEvent, "id">): TEvent | undefined {
        const index = this._events.findIndex((storedEvent) => storedEvent.id === eventId);
        if (index < 0) {
            return undefined;
        }

        const storedEvent = {
            ...event,
            id: eventId,
        } as TEvent;

        this._events[index] = storedEvent;
        this._onDidChange.fire();
        return storedEvent;
    }

    /**
     * In-place mutation escape hatch for small state flips (e.g. marking a
     * completion accepted). The mutator returns true when it changed the event.
     */
    public mutateEvent(eventId: string, mutator: (event: TEvent) => boolean): void {
        const event = this.getEvent(eventId);
        if (!event) {
            return;
        }

        if (mutator(event)) {
            this._onDidChange.fire();
        }
    }

    public clearEvents(): void {
        if (this._events.length === 0) {
            return;
        }

        this._events = [];
        this._onDidChange.fire();
    }

    public importEvents(events: TEvent[] | undefined, overrides: TOverrides | undefined): void {
        const prepare = this._options.prepareImportedEvent ?? ((event: TEvent) => ({ ...event }));
        const importedEvents = [...(events ?? [])].slice(-this._capacity).map(prepare);

        this._events = importedEvents;
        this._eventCounter = this.getHighestImportedCounter(importedEvents);
        const migrated = this._options.normalizeImportedOverrides
            ? this._options.normalizeImportedOverrides(overrides)
            : overrides;
        this._overrides = this._options.normalizeOverrides(
            migrated ?? { ...this._options.defaultOverrides },
        );
        this._logger.info(`Imported ${importedEvents.length} events into the capture store.`);
        this._onDidChange.fire();
    }

    public setPanelOpen(isOpen: boolean): void {
        this._panelOpen = isOpen;
    }

    public isPanelOpen(): boolean {
        return this._panelOpen;
    }

    /** Capture is live while the feature's panel is open, or when the feature's record-when-closed setting says so. */
    public shouldCapture(recordWhenClosed: boolean): boolean {
        return this._panelOpen || recordWhenClosed;
    }

    private getHighestImportedCounter(events: TEvent[]): number {
        const idPattern = new RegExp(`^${escapeRegExp(this._idPrefix)}-(\\d+)$`);
        return events.reduce((highest, event) => {
            const match = idPattern.exec(event.id);
            if (!match) {
                return highest;
            }

            const parsed = Number(match[1]);
            return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
        }, 0);
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Shared override-normalization helpers. Features compose these into their
// normalizeOverrides/normalizePartialOverrides implementations.
// ---------------------------------------------------------------------------

export function normalizeNullableString(
    value: string | null | undefined,
    preserveWhitespace: boolean = false,
): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = preserveWhitespace ? value : value.trim();
    return normalized.length > 0 ? normalized : null;
}

export function normalizeNullableBoolean(value: boolean | null | undefined): boolean | null {
    return typeof value === "boolean" ? value : null;
}

export function normalizeNullableNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeNullableJsonRecord(value: unknown): Record<string, unknown> | null {
    if (!isJsonRecord(value)) {
        return null;
    }

    return normalizeJsonRecord(value);
}

export function normalizeJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const normalizedValue = normalizeJsonValue(rawValue);
        if (normalizedValue !== undefined) {
            normalized[key] = normalizedValue;
        }
    }
    return normalized;
}

export function normalizeJsonValue(value: unknown): unknown {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeJsonValue(item)).filter((item) => item !== undefined);
    }

    if (isJsonRecord(value)) {
        return normalizeJsonRecord(value);
    }

    return undefined;
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

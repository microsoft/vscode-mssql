/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type QueryResultGridPerfKind = "legacy" | "beta";

export interface QueryResultGridPerfContext {
    enabled: boolean;
    gridKind: QueryResultGridPerfKind;
    gridId: string;
    batchId: number;
    resultId: number;
}

export type QueryResultGridPerfMetadata = Record<
    string,
    string | number | boolean | null | undefined
>;

export interface QueryResultGridPerfEvent {
    name: string;
    gridKind: QueryResultGridPerfKind;
    gridId: string;
    batchId: number;
    resultId: number;
    startTime: number;
    timestamp: number;
    duration?: number;
    metadata?: QueryResultGridPerfMetadata;
}

export interface QueryResultGridPerfSnapshot {
    enabled: boolean;
    events: QueryResultGridPerfEvent[];
}

export interface QueryResultGridPerfStore {
    enabled: boolean;
    events: QueryResultGridPerfEvent[];
    clear: () => void;
    snapshot: () => QueryResultGridPerfSnapshot;
}

declare global {
    interface Window {
        __mssqlGridPerf?: QueryResultGridPerfStore;
    }
}

const maxStoredEvents = 20000;

function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getStore(): QueryResultGridPerfStore {
    if (window.__mssqlGridPerf) {
        return window.__mssqlGridPerf;
    }

    const store: QueryResultGridPerfStore = {
        enabled: false,
        events: [],
        clear: () => {
            store.events = [];
        },
        snapshot: () => ({
            enabled: store.enabled,
            events: store.events.slice(),
        }),
    };

    window.__mssqlGridPerf = store;
    return store;
}

export function setQueryResultGridPerfEnabled(enabled: boolean): void {
    getStore().enabled = enabled;
}

export function getQueryResultGridPerfNow(): number {
    return now();
}

export function recordQueryResultGridPerfEvent(
    context: QueryResultGridPerfContext,
    name: string,
    metadata?: QueryResultGridPerfMetadata,
    startTime = now(),
    duration?: number,
): void {
    if (!context.enabled) {
        return;
    }

    const store = getStore();
    store.enabled = true;
    store.events.push({
        name,
        gridKind: context.gridKind,
        gridId: context.gridId,
        batchId: context.batchId,
        resultId: context.resultId,
        startTime,
        timestamp: now(),
        duration,
        metadata,
    });

    if (store.events.length > maxStoredEvents) {
        store.events.splice(0, store.events.length - maxStoredEvents);
    }
}

export async function measureQueryResultGridPerfAsync<T>(
    context: QueryResultGridPerfContext,
    name: string,
    metadata: QueryResultGridPerfMetadata | undefined,
    action: () => Promise<T>,
): Promise<T> {
    if (!context.enabled) {
        return action();
    }

    const startTime = now();
    try {
        const result = await action();
        recordQueryResultGridPerfEvent(context, name, metadata, startTime, now() - startTime);
        return result;
    } catch (error) {
        recordQueryResultGridPerfEvent(
            context,
            name,
            {
                ...metadata,
                failed: true,
            },
            startTime,
            now() - startTime,
        );
        throw error;
    }
}

export function scheduleQueryResultGridPerfPaint(
    context: QueryResultGridPerfContext,
    name: string,
    startTime: number,
    metadata?: QueryResultGridPerfMetadata,
): void {
    if (!context.enabled) {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            recordQueryResultGridPerfEvent(context, name, metadata, startTime, now() - startTime);
        });
    });
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetadataCatalogSnapshot } from "./catalogSnapshot.js";
import type { SqlMetadataCatalog, SqlMetadataLoader } from "./contracts.js";

/** Repository pattern: deduplicates loads and publishes only complete immutable snapshots. */
export class MetadataRepository {
    private currentSnapshot: SqlMetadataCatalog | undefined;
    private pending: Promise<SqlMetadataCatalog> | undefined;
    private pendingController: AbortController | undefined;
    private generation = 0;
    private nextVersion = 1;

    public constructor(private readonly loader: SqlMetadataLoader) {}

    public get current(): SqlMetadataCatalog | undefined {
        return this.currentSnapshot;
    }

    public load(signal?: AbortSignal): Promise<SqlMetadataCatalog> {
        if (this.currentSnapshot) {
            return observeCancellation(Promise.resolve(this.currentSnapshot), signal);
        }
        return this.refresh(signal);
    }

    public refresh(signal?: AbortSignal): Promise<SqlMetadataCatalog> {
        if (!this.pending) {
            this.startRefresh();
        }
        return observeCancellation(this.pending!, signal);
    }

    public invalidate(): void {
        this.currentSnapshot = undefined;
        this.generation++;
        const pendingController = this.pendingController;
        this.pending = undefined;
        this.pendingController = undefined;
        pendingController?.abort(new Error("SQL metadata cache invalidated"));
    }

    private startRefresh(): void {
        const controller = new AbortController();
        const generation = this.generation;
        const load = Promise.resolve()
            .then(() => this.loader.load(controller.signal))
            .then((result) => {
                if (generation !== this.generation || controller.signal.aborted) {
                    throw controller.signal.reason ?? new Error("SQL metadata cache invalidated");
                }
                const snapshot = new MetadataCatalogSnapshot(this.nextVersion++, result);
                this.currentSnapshot = snapshot;
                return snapshot;
            });
        const tracked = load.finally(() => {
            if (this.pending === tracked) {
                this.pending = undefined;
                this.pendingController = undefined;
            }
        });
        this.pending = tracked;
        this.pendingController = controller;
    }
}

/** Cancels only the waiting caller; a shared metadata load remains owned by the repository. */
function observeCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new Error("SQL metadata request was cancelled"));
    }
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => {
            cleanup();
            reject(signal.reason ?? new Error("SQL metadata request was cancelled"));
        };
        const cleanup = (): void => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            },
        );
    });
}

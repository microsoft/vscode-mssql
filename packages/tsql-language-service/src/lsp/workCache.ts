/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from "../core/cancellation.js";
import { StaleTsqlDocumentError, TsqlOperationCancelledError } from "./errors.js";
import type { TsqlDocument, TsqlDocumentWork, TsqlWorkContext } from "./types.js";

interface WorkEntry {
    readonly controller: AbortController;
    readonly promise: Promise<unknown>;
}

/** Deduplicates work per document generation and aborts it when that generation is replaced. */
export class TsqlDocumentWorkCache {
    private readonly entries = new WeakMap<TsqlDocument, Map<string | symbol, WorkEntry>>();

    public constructor(private readonly isCurrent: (document: TsqlDocument) => boolean) {}

    public compute<T>(
        document: TsqlDocument,
        key: string | symbol,
        work: TsqlDocumentWork<T>,
        callerToken?: CancellationTokenLike,
    ): Promise<T> {
        this.throwIfUnavailable(document, callerToken);
        let documentEntries = this.entries.get(document);
        if (!documentEntries) {
            documentEntries = new Map();
            this.entries.set(document, documentEntries);
        }
        let entry = documentEntries.get(key);
        if (!entry) {
            const controller = new AbortController();
            const documentToken = cancellationTokenFor(controller.signal);
            const context: TsqlWorkContext = {
                document,
                signal: controller.signal,
                cancellationToken: documentToken,
                throwIfCancelled: () =>
                    this.throwIfUnavailable(document, undefined, controller.signal),
            };
            const promise = Promise.resolve()
                .then(() => work(context))
                .then((value) => {
                    this.throwIfUnavailable(document, undefined, controller.signal);
                    return value;
                })
                .catch((error: unknown) => {
                    documentEntries?.delete(key);
                    throw error;
                });
            entry = { controller, promise };
            documentEntries.set(key, entry);
        }
        return waitForCaller(entry.promise as Promise<T>, callerToken);
    }

    public invalidate(document: TsqlDocument): void {
        const documentEntries = this.entries.get(document);
        if (!documentEntries) {
            return;
        }
        for (const entry of documentEntries.values()) {
            entry.controller.abort();
        }
        documentEntries.clear();
        this.entries.delete(document);
    }

    private throwIfUnavailable(
        document: TsqlDocument,
        token?: CancellationTokenLike,
        signal?: AbortSignal,
    ): void {
        if (token?.isCancellationRequested) {
            throw new TsqlOperationCancelledError();
        }
        if (signal?.aborted || !this.isCurrent(document)) {
            throw new StaleTsqlDocumentError(document.uri.toString(), document.version);
        }
    }
}

function waitForCaller<T>(
    promise: Promise<T>,
    token: CancellationTokenLike | undefined,
): Promise<T> {
    if (!token) {
        return promise;
    }
    if (token.isCancellationRequested) {
        return Promise.reject(new TsqlOperationCancelledError());
    }
    return new Promise<T>((resolve, reject) => {
        let subscription = token.onCancellationRequested(() => {
            subscription.dispose();
            reject(new TsqlOperationCancelledError());
        });
        void promise.then(
            (value) => {
                subscription.dispose();
                resolve(value);
            },
            (error: unknown) => {
                subscription.dispose();
                reject(error);
            },
        );
    });
}

function cancellationTokenFor(signal: AbortSignal): CancellationTokenLike {
    return {
        get isCancellationRequested(): boolean {
            return signal.aborted;
        },
        onCancellationRequested: (listener) => {
            const handler = () => listener();
            signal.addEventListener("abort", handler, { once: true });
            return { dispose: () => signal.removeEventListener("abort", handler) };
        },
    };
}

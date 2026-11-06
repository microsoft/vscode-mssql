/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DisposableResourceWorker {
    worker: Worker;
    dispose(): void;
}

export interface ResourceWorkerDependencies {
    fetchResource(url: URL): Promise<Response>;
    createObjectUrl(blob: Blob): string;
    revokeObjectUrl(url: string): void;
    createWorker(url: string): Worker;
}

const browserDependencies: ResourceWorkerDependencies = {
    fetchResource: (url) => fetch(url),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createWorker: (url) => new Worker(url, { type: "module" }),
};

/**
 * VS Code webviews expose extension files on a resource origin that Chromium
 * will not accept directly as a Worker script. Fetch the CSP-approved local
 * bundle and launch it from a short-lived blob URL instead.
 */
export async function createResourceWorker(
    resourceUrl: URL,
    dependencies: ResourceWorkerDependencies = browserDependencies,
): Promise<DisposableResourceWorker> {
    const response = await dependencies.fetchResource(resourceUrl);
    if (!response.ok) {
        throw new Error(`Worker resource request failed (${response.status}).`);
    }
    const objectUrl = dependencies.createObjectUrl(await response.blob());
    let disposed = false;
    try {
        const worker = dependencies.createWorker(objectUrl);
        return {
            worker,
            dispose: () => {
                if (disposed) return;
                disposed = true;
                worker.terminate();
                dependencies.revokeObjectUrl(objectUrl);
            },
        };
    } catch (error) {
        dependencies.revokeObjectUrl(objectUrl);
        throw error;
    }
}

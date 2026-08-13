/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type {
    ColumnMetadata,
    DatabaseMetadata,
    MetadataHydrationRequest,
    MetadataProvider,
    MetadataRefreshResult,
    MetadataView,
    ObjectMetadata,
    ObjectRef,
    ObjectResolution,
    ObjectSearchQuery,
    ParameterMetadata,
    SchemaMetadata,
} from "../metadata/index.js";

/**
 * Extension-owned bridge implemented by the dev/query catalog provider. The package deliberately
 * does not import MetadataService, CatalogSnapshot, VS Code events, or connection state.
 */
export interface DevQueryMetadataBridge {
    pin(): MetadataView;
    requestHydration(request: MetadataHydrationRequest): void;
    refresh(signal?: AbortSignal): Promise<MetadataRefreshResult>;
    subscribe(listener: () => void): Disposable;
}

export class DevQueryMetadataAdapter implements MetadataProvider {
    public readonly id = "dev-query";
    private _lastInner: MetadataView | undefined;
    private _lastView: MetadataView | undefined;

    public constructor(private readonly _bridge: DevQueryMetadataBridge) {}

    public pin(): MetadataView {
        const inner = this._bridge.pin();
        if (inner !== this._lastInner) {
            this._lastInner = inner;
            this._lastView = new DevQueryPinnedView(inner, this.id);
        }
        return this._lastView!;
    }

    public requestHydration(request: MetadataHydrationRequest): void {
        this._bridge.requestHydration(request);
    }

    public refresh(signal?: AbortSignal): Promise<MetadataRefreshResult> {
        return this._bridge.refresh(signal);
    }

    public onDidChange(listener: () => void): Disposable {
        return this._bridge.subscribe(listener);
    }
}

class DevQueryPinnedView implements MetadataView {
    public constructor(
        private readonly _inner: MetadataView,
        public readonly providerId: string,
    ) {}

    public get generation(): number {
        return this._inner.generation;
    }

    public get environment() {
        return this._inner.environment;
    }

    public get completeness() {
        return this._inner.completeness;
    }

    public get publishedAt(): number {
        return this._inner.publishedAt;
    }

    public resolveObject(parts: readonly string[]): ObjectResolution {
        return this._inner.resolveObject(parts);
    }

    public object(ref: ObjectRef): ObjectMetadata | undefined {
        return this._inner.object(ref);
    }

    public columns(ref: ObjectRef): readonly ColumnMetadata[] | undefined {
        return this._inner.columns(ref);
    }

    public parameters(ref: ObjectRef): readonly ParameterMetadata[] | undefined {
        return this._inner.parameters(ref);
    }

    public searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[] {
        return this._inner.searchObjects(query);
    }

    public schemas(database?: string): readonly SchemaMetadata[] | undefined {
        return this._inner.schemas(database);
    }

    public databases(): readonly DatabaseMetadata[] | undefined {
        return this._inner.databases();
    }
}

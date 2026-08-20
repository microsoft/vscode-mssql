/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnMetadata,
    MetadataHydrationRequest,
    MetadataProvider,
    MetadataView,
    ObjectMetadata,
} from "../metadata/index.js";

/** Shared, explicitly attributed catalog access used by completion, hover, and signatures. */
export class CatalogFeatureContext {
    public constructor(private readonly _metadata: MetadataProvider) {}

    public columns(
        view: MetadataView,
        object: ObjectMetadata,
        reason: string,
    ): { readonly value?: readonly ColumnMetadata[]; readonly incomplete: boolean } {
        const state = view.columnState(object.ref);
        if (state.kind === "loaded") {
            this.noteResident(
                { section: "columns", object: object.ref, priority: "interactive" },
                reason,
            );
            return { value: state.value, incomplete: false };
        }
        if (state.kind === "failed" && state.previous) {
            return { value: state.previous, incomplete: true };
        }
        this.hydrate({ section: "columns", object: object.ref, priority: "interactive" }, reason);
        return { incomplete: true };
    }

    public noteResident(request: Omit<MetadataHydrationRequest, "reason">, reason: string): void {
        this._metadata.noteResidentUse?.({ ...request, reason });
    }

    public hydrate(request: Omit<MetadataHydrationRequest, "reason">, reason: string): void {
        this._metadata.requestHydration({ ...request, reason });
    }
}

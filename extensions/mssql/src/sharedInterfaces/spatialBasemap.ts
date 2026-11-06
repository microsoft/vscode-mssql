/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Spatial basemap RPCs (SPA-10, addendum §6.3). Opaque by construction: the
 * webview sends ids and tile coordinates; the host answers with sanitized
 * descriptors and LOCAL webview URIs backed by cache files. No URL template,
 * endpoint, credential, header, or consent record crosses this boundary in
 * either direction.
 */

import { RequestType } from "vscode-jsonrpc";

export interface QsSpatialBasemapDescriptor {
    readonly id: string;
    readonly displayName: string;
    readonly kind: "xyzRaster";
    readonly online: true;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly attribution: { readonly text: string; readonly termsUrl?: string };
}

export interface QsSpatialBasemapListResult {
    readonly layers: readonly QsSpatialBasemapDescriptor[];
    readonly trusted: boolean;
}

export interface QsSpatialBasemapOpenParams {
    readonly layerId: string;
    readonly activeProjection: "EPSG:4326" | "EPSG:3857" | "planar";
    /** True only for a user gesture; restores never prompt (D-0027). */
    readonly interactive: boolean;
}

export interface QsSpatialBasemapOpenResult {
    readonly status:
        | "ready"
        | "consentRequired"
        | "declined"
        | "incompatible"
        | "untrusted"
        | "unavailable";
    readonly handle?: string;
    readonly generation?: number;
    readonly tileProjection?: "EPSG:3857";
    readonly minZoom?: number;
    readonly maxZoom?: number;
}

export interface QsSpatialBasemapTileParams {
    readonly handle: string;
    readonly generation: number;
    readonly z: number;
    readonly x: number;
    readonly y: number;
}

export interface QsSpatialBasemapTileResult {
    readonly status: "ready" | "notFound" | "cancelled" | "unavailable";
    /** webview.asWebviewUri of a cache file — never a remote URL. */
    readonly localUri?: string;
}

export interface QsSpatialBasemapCloseParams {
    readonly handle: string;
    readonly reason: "layerChange" | "hidden" | "disposed";
}

export namespace QsSpatialBasemapListRequest {
    export const type = new RequestType<Record<string, never>, QsSpatialBasemapListResult, void>(
        "qs/spatial.basemap.list",
    );
}
export namespace QsSpatialBasemapOpenRequest {
    export const type = new RequestType<
        QsSpatialBasemapOpenParams,
        QsSpatialBasemapOpenResult,
        void
    >("qs/spatial.basemap.open");
}
export namespace QsSpatialBasemapTileRequest {
    export const type = new RequestType<
        QsSpatialBasemapTileParams,
        QsSpatialBasemapTileResult,
        void
    >("qs/spatial.basemap.tile");
}
export namespace QsSpatialBasemapCloseRequest {
    export const type = new RequestType<QsSpatialBasemapCloseParams, void, void>(
        "qs/spatial.basemap.close",
    );
}

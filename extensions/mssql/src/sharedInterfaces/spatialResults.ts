/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Host ↔ webview contracts for the bounded Spatial pull session (D-0020). */

import { RequestType } from "vscode-jsonrpc";
import type { SpatialCellEncodingV1, SpatialKind } from "./queryResultCellCodec";

export interface QsSpatialOpenParams {
    resultSetId: string;
    spatialColumn: number;
    labelColumn?: number;
    colorColumn?: number;
}

export interface QsSpatialOpenResult {
    handle: string;
    generation: number;
    totalRows: number;
    kind?: SpatialKind;
    chunkRows: number;
    error?: string;
}

export interface QsSpatialFeatureTransport {
    /** Zero-based source result-row ordinal. */
    ordinal: number;
    spatial: SpatialCellEncodingV1 | null;
    /** Bounded display-only values; never diagnostics. */
    label?: string;
    colorValue?: string;
}

export interface QsSpatialNextParams {
    handle: string;
    generation: number;
    sequence: number;
}

export interface QsSpatialNextResult {
    generation: number;
    sequence: number;
    done: boolean;
    features: QsSpatialFeatureTransport[];
    scannedRows: number;
    wireBytes: number;
    error?: string;
}

export namespace QsSpatialOpenRequest {
    export const type = new RequestType<QsSpatialOpenParams, QsSpatialOpenResult, void>(
        "qs/spatial.open",
    );
}
export namespace QsSpatialNextRequest {
    export const type = new RequestType<QsSpatialNextParams, QsSpatialNextResult, void>(
        "qs/spatial.next",
    );
}
export namespace QsSpatialCancelRequest {
    export const type = new RequestType<{ handle: string; generation: number }, void, void>(
        "qs/spatial.cancel",
    );
}
export namespace QsSpatialCloseRequest {
    export const type = new RequestType<{ handle: string }, void, void>("qs/spatial.close");
}

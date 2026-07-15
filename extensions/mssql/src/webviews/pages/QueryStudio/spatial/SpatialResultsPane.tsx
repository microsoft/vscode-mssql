/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { Rpc } from "../resultsGridShared";
import {
    QsSpatialCancelRequest,
    QsSpatialCloseRequest,
    QsSpatialNextRequest,
    QsSpatialNextParams,
    QsSpatialNextResult,
    QsSpatialOpenRequest,
    QsSpatialOpenParams,
    QsSpatialOpenResult,
} from "../../../../sharedInterfaces/spatialResults";
import type { QsSpatialPanelViewState } from "../../../../sharedInterfaces/queryStudioViewState";
import { perfMark, perfMarkAfterNextPaint } from "../../../common/perfMarks";
import { QsUpdateGridSelectionRequest } from "../../../../sharedInterfaces/queryStudio";
import {
    QsSpatialBasemapCloseRequest,
    QsSpatialBasemapListRequest,
    QsSpatialBasemapOpenRequest,
    QsSpatialBasemapTileRequest,
    type QsSpatialBasemapDescriptor,
    type QsSpatialBasemapListResult,
    type QsSpatialBasemapOpenParams,
    type QsSpatialBasemapOpenResult,
} from "../../../../sharedInterfaces/spatialBasemap";
import { SpatialMap, type SpatialMapProps } from "./SpatialMap";
import {
    SPATIAL_DERIVED_BYTES_BUDGET,
    SPATIAL_VERTEX_BUDGET,
    resolveSpatialRendererTier,
    type SpatialDecodeResponse,
    type SpatialDecodedFeature,
} from "./spatialWorkerProtocol";
import { locConstants } from "../../../common/locConstants";
import { createResourceWorker, type DisposableResourceWorker } from "./resourceWorker";

export interface SpatialColumnChoice {
    resultSetId: string;
    resultSetLabel: string;
    columnOrdinal: number;
    columnName: string;
    kind: "geometry" | "geography";
    totalRows: number;
    columns: readonly { ordinal: number; name: string; sqlType?: string }[];
}

export interface SpatialResultsPaneProps {
    rpc: Rpc;
    columns: readonly SpatialColumnChoice[];
    runKey: string;
    active: boolean;
    panelVisible: boolean;
    /** mssql.queryStudio.spatial.basemap.enabled (SPA-10): shows the Layers selector. */
    basemapEnabled: boolean;
    initialViewState?: QsSpatialPanelViewState;
    onViewStateChange?: (state: QsSpatialPanelViewState) => void;
}

type LoadState =
    | { kind: "idle" }
    | { kind: "loading"; scanned: number; total: number }
    | {
          kind: "ready";
          scanned: number;
          total: number;
          partialReason?:
              | "rowBudget"
              | "payloadBudget"
              | "storeShortRead"
              | "vertexBudget"
              | "derivedMemoryBudget";
      }
    | { kind: "error"; message: string };

function initialState(value?: QsSpatialPanelViewState): QsSpatialPanelViewState {
    return (
        value ?? {
            groupBy: "none",
            renderer: "auto",
            sidebarOpen: true,
            listOpen: true,
            detailsOpen: true,
            filters: { showNull: true, showEmpty: true, showUnsupported: true },
            listScrollTop: 0,
        }
    );
}

function workerDecode(
    worker: Worker,
    generation: number,
    sequence: number,
    features: QsSpatialNextResult["features"],
    remainingVertices: number,
    remainingDerivedBytes: number,
): Promise<SpatialDecodeResponse> {
    return new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent<SpatialDecodeResponse>) => {
            if (
                event.data.type === "decoded" &&
                event.data.generation === generation &&
                event.data.sequence === sequence
            ) {
                worker.removeEventListener("message", onMessage);
                worker.removeEventListener("error", onError);
                resolve(event.data);
            }
        };
        const onError = (event: ErrorEvent) => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            reject(new Error(event.message || locConstants.spatialResults.decodeWorkerFailed));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({
            type: "decode",
            generation,
            sequence,
            features,
            remainingVertices,
            remainingDerivedBytes,
        });
    });
}

function VirtualFeatureList(props: {
    features: readonly SpatialDecodedFeature[];
    selected?: number;
    onSelect(ordinal: number): void;
    initialScrollTop: number;
    onScroll(scrollTop: number): void;
}): React.JSX.Element {
    const rowHeight = 30;
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = React.useState(props.initialScrollTop);
    const [height, setHeight] = React.useState(300);
    React.useLayoutEffect(() => {
        const element = viewportRef.current;
        if (!element) return;
        element.scrollTop = props.initialScrollTop;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
    const end = Math.min(props.features.length, start + Math.ceil(height / rowHeight) + 10);
    return (
        <div
            className="qs-spatial-list"
            ref={viewportRef}
            role="listbox"
            aria-label={locConstants.spatialResults.featuresLabel}
            onScroll={(event) => {
                const top = event.currentTarget.scrollTop;
                setScrollTop(top);
                props.onScroll(top);
            }}>
            <div style={{ height: props.features.length * rowHeight, position: "relative" }}>
                {props.features.slice(start, end).map((feature, index) => (
                    <button
                        key={feature.ordinal}
                        type="button"
                        role="option"
                        aria-selected={props.selected === feature.ordinal}
                        className={`qs-spatial-list-row ${props.selected === feature.ordinal ? "selected" : ""}`}
                        style={{ top: (start + index) * rowHeight, height: rowHeight }}
                        onClick={() => props.onSelect(feature.ordinal)}>
                        <span className={`qs-spatial-status-dot ${feature.status}`} />
                        <span className="qs-spatial-row-label">
                            {feature.label ||
                                `${locConstants.spatialResults.sourceRow} ${feature.ordinal + 1}`}
                        </span>
                        <span className="qs-spatial-row-kind">
                            {feature.geometryType ?? feature.status}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export function SpatialResultsPane(props: SpatialResultsPaneProps): React.JSX.Element {
    const first = props.columns[0];
    const [viewState, setViewState] = React.useState(() => initialState(props.initialViewState));
    const [selectedKey, setSelectedKey] = React.useState(() => {
        const selected = props.initialViewState?.selectedColumn;
        return selected &&
            props.columns.some(
                (column) =>
                    column.resultSetId === selected.resultSetId &&
                    column.columnOrdinal === selected.columnOrdinal,
            )
            ? `${selected.resultSetId}:${selected.columnOrdinal}`
            : first
              ? `${first.resultSetId}:${first.columnOrdinal}`
              : "";
    });
    const selectedColumn =
        props.columns.find(
            (column) => `${column.resultSetId}:${column.columnOrdinal}` === selectedKey,
        ) ?? first;
    const [features, setFeatures] = React.useState<SpatialDecodedFeature[]>([]);
    const [loadState, setLoadState] = React.useState<LoadState>({ kind: "idle" });
    const [fitNonce, setFitNonce] = React.useState(0);

    const updateState = React.useCallback(
        (patch: Partial<QsSpatialPanelViewState>) => {
            setViewState((current) => {
                const next = { ...current, ...patch };
                props.onViewStateChange?.(next);
                return next;
            });
        },
        [props.onViewStateChange],
    );

    React.useEffect(() => {
        if (!props.active || !props.panelVisible || !selectedColumn) {
            return;
        }
        let canceled = false;
        let handle = "";
        let generation = 0;
        let resourceWorker: DisposableResourceWorker | undefined;
        setFeatures([]);
        setLoadState({ kind: "loading", scanned: 0, total: selectedColumn.totalRows });
        updateState({
            selectedColumn: {
                resultSetId: selectedColumn.resultSetId,
                columnOrdinal: selectedColumn.columnOrdinal,
            },
        });
        const load = async () => {
            resourceWorker = await createResourceWorker(
                new URL("spatialDecodeWorker.js", document.baseURI),
            );
            const worker = resourceWorker.worker;
            const opened = await props.rpc.sendRequest<QsSpatialOpenParams, QsSpatialOpenResult>(
                QsSpatialOpenRequest.type,
                {
                    resultSetId: selectedColumn.resultSetId,
                    spatialColumn: selectedColumn.columnOrdinal,
                    ...(viewState.labelColumnOrdinal !== undefined
                        ? { labelColumn: viewState.labelColumnOrdinal }
                        : {}),
                    ...(viewState.colorColumnOrdinal !== undefined
                        ? { colorColumn: viewState.colorColumnOrdinal }
                        : {}),
                },
            );
            if (opened.error || !opened.handle) {
                throw new Error(opened.error ?? locConstants.spatialResults.sessionOpenFailed);
            }
            handle = opened.handle;
            generation = opened.generation;
            let sequence = 0;
            let scanned = 0;
            let rendered = 0;
            let vertices = 0;
            let skipped = 0;
            let derivedBytes = 0;
            let allRenderableArePoints = true;
            const renderStartedAt = performance.now();
            while (!canceled) {
                const chunk = await props.rpc.sendRequest<QsSpatialNextParams, QsSpatialNextResult>(
                    QsSpatialNextRequest.type,
                    { handle, generation, sequence },
                );
                if (chunk.error) throw new Error(chunk.error);
                perfMark("mssql.queryResults.spatial.decode.begin", {
                    mode: "worker",
                });
                const decoded = await workerDecode(
                    worker,
                    chunk.generation,
                    chunk.sequence,
                    chunk.features,
                    Math.max(0, SPATIAL_VERTEX_BUDGET - vertices),
                    Math.max(0, SPATIAL_DERIVED_BYTES_BUDGET - derivedBytes),
                );
                if (canceled) return;
                perfMark("mssql.queryResults.spatial.decode.end", {
                    outcome: decoded.errors > 0 ? "partial" : "ok",
                    features: decoded.decoded,
                    vertices: decoded.vertices,
                    skipped: decoded.unsupported + decoded.errors,
                    derivedBytes: decoded.derivedBytes,
                    ms: Math.round(decoded.elapsedMs * 100) / 100,
                });
                setFeatures((current) => [...current, ...decoded.features]);
                rendered += decoded.decoded;
                allRenderableArePoints =
                    allRenderableArePoints &&
                    decoded.features.every(
                        (feature) => feature.status !== "ready" || feature.geometryType === "Point",
                    );
                vertices += decoded.vertices;
                skipped += decoded.unsupported + decoded.errors;
                derivedBytes += decoded.derivedBytes;
                scanned += chunk.scannedRows;
                const partialReason = decoded.budgetReason ?? chunk.partialReason;
                setLoadState({
                    kind: chunk.done || partialReason ? "ready" : "loading",
                    scanned,
                    total: opened.totalRows,
                    ...(partialReason ? { partialReason } : {}),
                });
                if (decoded.budgetReason) {
                    perfMark("mssql.queryResults.spatial.decode.cancel", {
                        reason: decoded.budgetReason,
                    });
                    void props.rpc.sendRequest(QsSpatialCancelRequest.type, {
                        handle,
                        generation,
                    });
                }
                if (chunk.done || decoded.budgetReason) {
                    const settledTier = resolveSpatialRendererTier(
                        allRenderableArePoints,
                        rendered,
                        viewState.renderer,
                    );
                    void perfMarkAfterNextPaint("mssql.queryResults.spatial.render.settled", {
                        tier: settledTier,
                        features: rendered,
                        vertices,
                        skipped,
                        partial: partialReason ? "true" : "false",
                        longTasks: 0,
                        derivedBytes,
                        ms: Math.round((performance.now() - renderStartedAt) * 100) / 100,
                        layer: effectiveBasemapLayerRef.current,
                    });
                    break;
                }
                sequence++;
            }
        };
        void load().catch((error) => {
            if (!canceled) {
                setLoadState({
                    kind: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        });
        return () => {
            canceled = true;
            resourceWorker?.dispose();
            if (handle) {
                void props.rpc.sendRequest(QsSpatialCancelRequest.type, { handle, generation });
                void props.rpc.sendRequest(QsSpatialCloseRequest.type, { handle });
            }
            perfMark("mssql.queryResults.spatial.decode.cancel", {
                reason: "generationInvalidated",
            });
        };
    }, [
        props.active,
        props.panelVisible,
        props.rpc,
        props.runKey,
        selectedColumn?.columnOrdinal,
        selectedColumn?.resultSetId,
        viewState.colorColumnOrdinal,
        viewState.labelColumnOrdinal,
    ]);

    const filteredFeatures = React.useMemo(
        () =>
            features.filter((feature) => {
                if (
                    viewState.filters.geometryType !== undefined &&
                    feature.geometryType !== viewState.filters.geometryType
                ) {
                    return false;
                }
                if (
                    viewState.filters.srid !== undefined &&
                    feature.srid !== viewState.filters.srid
                ) {
                    return false;
                }
                if (feature.status === "null") return viewState.filters.showNull;
                if (feature.status === "unsupported" || feature.status === "error") {
                    return viewState.filters.showUnsupported;
                }
                if (feature.status === "ready" && feature.vertices === 0) {
                    return viewState.filters.showEmpty;
                }
                return true;
            }),
        [features, viewState.filters],
    );
    // Map-layer eligibility (SPA-10 / D-0030): a world layer may only sit
    // under features whose decoded projection is EPSG:4326 or EPSG:3857.
    // One planar/unknown-SRID feature in the rendered set disables layers —
    // arbitrary Cartesian data is never placed on Earth by guesswork.
    const basemapEligible = React.useMemo(() => {
        const ready = filteredFeatures.filter((feature) => feature.status === "ready");
        return ready.length > 0 && ready.every((feature) => feature.projection !== "planar");
    }, [filteredFeatures]);
    const [basemapState, setBasemapState] = React.useState<
        "idle" | "loading" | "ready" | "unavailable"
    >("idle");
    const selectedLayerId = viewState.layerId ?? "none";

    // Online sources: sanitized descriptors only (ids, names, attribution).
    const [onlineLayers, setOnlineLayers] = React.useState<readonly QsSpatialBasemapDescriptor[]>(
        [],
    );
    const [workspaceTrusted, setWorkspaceTrusted] = React.useState(true);
    React.useEffect(() => {
        if (!props.basemapEnabled) return;
        let cancelled = false;
        void props.rpc
            .sendRequest<Record<string, never>, QsSpatialBasemapListResult>(
                QsSpatialBasemapListRequest.type,
                {},
            )
            .then((result) => {
                if (!cancelled) {
                    setOnlineLayers(result.layers);
                    setWorkspaceTrusted(result.trusted);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [props.basemapEnabled, props.rpc]);

    // Online session lifecycle (D-0027): interactive opens may prompt for
    // consent; restores never do. Sessions close on layer change, ineligible
    // data, and rerun (runKey). A declined consent reverts the selection.
    const selectedOnline = onlineLayers.find((layer) => layer.id === selectedLayerId);
    const [onlineSession, setOnlineSession] = React.useState<
        { handle: string; generation: number; minZoom: number; maxZoom: number } | undefined
    >(undefined);
    const [onlineStatus, setOnlineStatus] = React.useState<
        QsSpatialBasemapOpenResult["status"] | "idle"
    >("idle");
    const interactiveSelectRef = React.useRef(false);
    const activeProjection = React.useMemo(() => {
        if (!basemapEligible) return "planar" as const;
        return filteredFeatures.some(
            (feature) => feature.status === "ready" && feature.projection === "EPSG:4326",
        )
            ? ("EPSG:4326" as const)
            : ("EPSG:3857" as const);
    }, [basemapEligible, filteredFeatures]);
    React.useEffect(() => {
        if (!props.basemapEnabled || !selectedOnline || !basemapEligible) {
            setOnlineSession(undefined);
            if (!selectedOnline) setOnlineStatus("idle");
            return;
        }
        let cancelled = false;
        let opened: string | undefined;
        const interactive = interactiveSelectRef.current;
        interactiveSelectRef.current = false;
        void props.rpc
            .sendRequest<QsSpatialBasemapOpenParams, QsSpatialBasemapOpenResult>(
                QsSpatialBasemapOpenRequest.type,
                { layerId: selectedOnline.id, activeProjection, interactive },
            )
            .then((result) => {
                if (cancelled) return;
                setOnlineStatus(result.status);
                if (result.status === "ready" && result.handle) {
                    opened = result.handle;
                    setOnlineSession({
                        handle: result.handle,
                        generation: result.generation ?? 0,
                        minZoom: result.minZoom ?? 0,
                        maxZoom: result.maxZoom ?? 19,
                    });
                } else if (result.status === "declined") {
                    updateState({ layerId: undefined });
                }
            })
            .catch(() => {
                if (!cancelled) setOnlineStatus("unavailable");
            });
        return () => {
            cancelled = true;
            setOnlineSession(undefined);
            if (opened) {
                void props.rpc.sendRequest(QsSpatialBasemapCloseRequest.type, {
                    handle: opened,
                    reason: "layerChange",
                });
            }
        };
    }, [props.basemapEnabled, selectedOnline?.id, basemapEligible, activeProjection, props.runKey]);

    const effectiveBasemapLayer: SpatialMapProps["basemapLayer"] =
        !props.basemapEnabled || !basemapEligible
            ? "none"
            : selectedLayerId === "worldOutline"
              ? "worldOutline"
              : selectedOnline && onlineSession
                ? {
                      kind: "xyzRaster" as const,
                      requestTile: (coords: { z: number; x: number; y: number }) =>
                          props.rpc.sendRequest(QsSpatialBasemapTileRequest.type, {
                              handle: onlineSession.handle,
                              generation: onlineSession.generation,
                              ...coords,
                          }),
                      session: onlineSession,
                  }
                : "none";
    const effectiveBasemapLayerRef = React.useRef("none" as string);
    effectiveBasemapLayerRef.current =
        typeof effectiveBasemapLayer === "string" ? effectiveBasemapLayer : "xyzRaster";

    const selectedFeature = features.find(
        (feature) => feature.ordinal === viewState.selectedRowOrdinal,
    );
    const labelCandidates = selectedColumn?.columns.filter(
        (column) => column.ordinal !== selectedColumn.columnOrdinal,
    );
    const readyCount = features.filter((feature) => feature.status === "ready").length;
    const unavailableCount = features.length - readyCount;
    const geometryTypes = React.useMemo(
        () =>
            Array.from(
                new Set(
                    features.flatMap((feature) =>
                        feature.geometryType ? [feature.geometryType] : [],
                    ),
                ),
            ).sort(),
        [features],
    );
    const srids = React.useMemo(
        () =>
            Array.from(
                new Set(
                    features.flatMap((feature) =>
                        feature.srid !== undefined ? [feature.srid] : [],
                    ),
                ),
            ).sort((left, right) => left - right),
        [features],
    );
    const groupSummary = React.useMemo(() => {
        if (viewState.groupBy === "none") return undefined;
        const counts = new Map<string, number>();
        for (const feature of features) {
            const key =
                viewState.groupBy === "srid"
                    ? String(feature.srid ?? "—")
                    : (feature.geometryType ?? feature.status);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 8)
            .map(([key, count]) => `${key}: ${count.toLocaleString()}`)
            .join(" · ");
    }, [features, viewState.groupBy]);

    if (!selectedColumn) {
        return (
            <div className="qs-spatial-empty">{locConstants.spatialResults.noEligibleColumns}</div>
        );
    }

    const selectFeature = (selectedRowOrdinal: number) => {
        updateState({ selectedRowOrdinal });
        void props.rpc.sendRequest(QsUpdateGridSelectionRequest.type, {
            resultSetId: selectedColumn.resultSetId,
            spatial: { row: selectedRowOrdinal, column: selectedColumn.columnOrdinal },
            selectedCellCount: 1,
            selectedRowCount: 1,
            displayedRowCount: selectedColumn.totalRows,
            reason: "spatial",
        });
    };

    return (
        <section className="qs-spatial-root" aria-label={locConstants.spatialResults.analysisLabel}>
            <div
                className="qs-spatial-toolbar"
                role="toolbar"
                aria-label={locConstants.spatialResults.controlsLabel}>
                <label>
                    <span>{locConstants.spatialResults.column}</span>
                    <select
                        value={selectedKey}
                        onChange={(event) => setSelectedKey(event.target.value)}>
                        {props.columns.map((column) => (
                            <option
                                key={`${column.resultSetId}:${column.columnOrdinal}`}
                                value={`${column.resultSetId}:${column.columnOrdinal}`}>
                                {column.resultSetLabel} · {column.columnName}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{locConstants.spatialResults.label}</span>
                    <select
                        value={viewState.labelColumnOrdinal ?? ""}
                        onChange={(event) =>
                            updateState({
                                labelColumnOrdinal:
                                    event.target.value === ""
                                        ? undefined
                                        : Number(event.target.value),
                            })
                        }>
                        <option value="">{locConstants.spatialResults.rowNumber}</option>
                        {labelCandidates?.map((column) => (
                            <option key={column.ordinal} value={column.ordinal}>
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{locConstants.spatialResults.colorBy}</span>
                    <select
                        value={viewState.colorColumnOrdinal ?? ""}
                        onChange={(event) =>
                            updateState({
                                colorColumnOrdinal:
                                    event.target.value === ""
                                        ? undefined
                                        : Number(event.target.value),
                            })
                        }>
                        <option value="">{locConstants.spatialResults.geometryType}</option>
                        {labelCandidates?.map((column) => (
                            <option key={column.ordinal} value={column.ordinal}>
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{locConstants.spatialResults.group}</span>
                    <select
                        value={viewState.groupBy}
                        onChange={(event) =>
                            updateState({
                                groupBy: event.target.value as QsSpatialPanelViewState["groupBy"],
                            })
                        }>
                        <option value="none">{locConstants.common.none}</option>
                        <option value="srid">{locConstants.spatialResults.srid}</option>
                        <option value="geometryType">
                            {locConstants.spatialResults.geometryType}
                        </option>
                    </select>
                </label>
                <label>
                    <span>{locConstants.spatialResults.renderer}</span>
                    <select
                        value={viewState.renderer}
                        onChange={(event) =>
                            updateState({
                                renderer: event.target.value as QsSpatialPanelViewState["renderer"],
                            })
                        }>
                        <option value="auto">{locConstants.spatialResults.automatic}</option>
                        <option value="canvas">{locConstants.spatialResults.canvas}</option>
                        <option value="clusters">{locConstants.spatialResults.clusters}</option>
                        <option value="gpuPoints">{locConstants.spatialResults.gpuPoints}</option>
                    </select>
                </label>
                {props.basemapEnabled ? (
                    <label>
                        <span>{locConstants.spatialResults.layers}</span>
                        <select
                            value={selectedLayerId}
                            onChange={(event) => {
                                setBasemapState("idle");
                                setOnlineStatus("idle");
                                interactiveSelectRef.current = true;
                                updateState({
                                    layerId:
                                        event.target.value === "none"
                                            ? undefined
                                            : event.target.value,
                                });
                            }}>
                            <option value="none">{locConstants.common.none}</option>
                            <option value="worldOutline" disabled={!basemapEligible}>
                                {locConstants.spatialResults.worldOutline}
                            </option>
                            {onlineLayers.map((layer) => (
                                <option
                                    key={layer.id}
                                    value={layer.id}
                                    disabled={!basemapEligible || !workspaceTrusted}>
                                    {locConstants.spatialResults.onlineLayerOption(
                                        layer.displayName,
                                    )}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <button type="button" className="qs-btn" onClick={() => setFitNonce((n) => n + 1)}>
                    <span className="codicon codicon-screen-full" aria-hidden="true" />{" "}
                    {locConstants.spatialResults.fit}
                </button>
            </div>
            <div className="qs-spatial-facts" aria-live="polite">
                <span>{selectedColumn.kind.toUpperCase()}</span>
                <span>{locConstants.spatialResults.renderable(readyCount)}</span>
                <span>{locConstants.spatialResults.unavailable(unavailableCount)}</span>
                <span>
                    {loadState.kind === "loading" || loadState.kind === "ready"
                        ? locConstants.spatialResults.rowProgress(
                              loadState.scanned,
                              loadState.total,
                          )
                        : loadState.kind === "error"
                          ? loadState.message
                          : locConstants.spatialResults.waiting}
                </span>
                <span>
                    {selectedLayerId === "none" || !props.basemapEnabled
                        ? locConstants.spatialResults.offline
                        : !basemapEligible
                          ? locConstants.spatialResults.layerUnavailableForCrs
                          : selectedLayerId === "worldOutline"
                            ? basemapState === "unavailable"
                                ? locConstants.spatialResults.layerFailed
                                : locConstants.spatialResults.worldOutlineActive
                            : onlineStatus === "untrusted"
                              ? locConstants.spatialResults.layerUntrusted
                              : onlineStatus === "consentRequired"
                                ? locConstants.spatialResults.layerConsentRequired
                                : onlineStatus === "ready" && basemapState !== "unavailable"
                                  ? locConstants.spatialResults.onlineLayerActive(
                                        selectedOnline?.displayName ?? selectedLayerId,
                                    )
                                  : locConstants.spatialResults.layerFailed}
                </span>
                {loadState.kind === "ready" && loadState.partialReason ? (
                    <span>{locConstants.spatialResults.limited(loadState.partialReason)}</span>
                ) : null}
                {groupSummary ? (
                    <span>{locConstants.spatialResults.groups(groupSummary)}</span>
                ) : null}
            </div>
            <div className="qs-spatial-body">
                {viewState.listOpen ? (
                    <aside className="qs-spatial-sidebar">
                        <div className="qs-spatial-filter-row">
                            <label>
                                <select
                                    aria-label={locConstants.spatialResults.geometryType}
                                    value={viewState.filters.geometryType ?? ""}
                                    onChange={(event) =>
                                        updateState({
                                            filters: {
                                                ...viewState.filters,
                                                geometryType: event.target.value || undefined,
                                            },
                                        })
                                    }>
                                    <option value="">
                                        {locConstants.spatialResults.allGeometryTypes}
                                    </option>
                                    {geometryTypes.map((geometryType) => (
                                        <option key={geometryType} value={geometryType}>
                                            {geometryType}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <select
                                    aria-label={locConstants.spatialResults.srid}
                                    value={viewState.filters.srid ?? ""}
                                    onChange={(event) =>
                                        updateState({
                                            filters: {
                                                ...viewState.filters,
                                                srid:
                                                    event.target.value === ""
                                                        ? undefined
                                                        : Number(event.target.value),
                                            },
                                        })
                                    }>
                                    <option value="">{locConstants.spatialResults.allSrids}</option>
                                    {srids.map((srid) => (
                                        <option key={srid} value={srid}>
                                            {srid}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {(["showNull", "showEmpty", "showUnsupported"] as const).map((key) => (
                                <label key={key}>
                                    <input
                                        type="checkbox"
                                        checked={viewState.filters[key]}
                                        onChange={(event) =>
                                            updateState({
                                                filters: {
                                                    ...viewState.filters,
                                                    [key]: event.target.checked,
                                                },
                                            })
                                        }
                                    />
                                    {key === "showNull"
                                        ? locConstants.spatialResults.null
                                        : key === "showEmpty"
                                          ? locConstants.spatialResults.empty
                                          : locConstants.spatialResults.unsupported}
                                </label>
                            ))}
                        </div>
                        <VirtualFeatureList
                            features={filteredFeatures}
                            selected={viewState.selectedRowOrdinal}
                            onSelect={selectFeature}
                            initialScrollTop={viewState.listScrollTop}
                            onScroll={(listScrollTop) => updateState({ listScrollTop })}
                        />
                    </aside>
                ) : null}
                <main className="qs-spatial-map-region">
                    <SpatialMap
                        key={`${props.runKey}:${selectedKey}:${viewState.labelColumnOrdinal ?? -1}:${viewState.colorColumnOrdinal ?? -1}`}
                        features={filteredFeatures}
                        selectedOrdinal={viewState.selectedRowOrdinal}
                        onSelect={selectFeature}
                        initialCamera={viewState.camera}
                        onCameraChange={(camera) => updateState({ camera })}
                        fitNonce={fitNonce}
                        renderer={viewState.renderer}
                        basemapLayer={effectiveBasemapLayer}
                        onBasemapState={setBasemapState}
                    />
                    {loadState.kind === "loading" ? (
                        <div className="qs-spatial-progress" role="status">
                            {locConstants.spatialResults.loadingProgress(
                                loadState.scanned,
                                loadState.total,
                            )}
                        </div>
                    ) : null}
                    {typeof effectiveBasemapLayer !== "string" && selectedOnline ? (
                        // Attribution stays visible over the map whenever an
                        // online layer is active (addendum §4.1).
                        <div className="qs-spatial-attribution">
                            {selectedOnline.attribution.termsUrl ? (
                                <a href={selectedOnline.attribution.termsUrl}>
                                    {selectedOnline.attribution.text}
                                </a>
                            ) : (
                                selectedOnline.attribution.text
                            )}
                        </div>
                    ) : null}
                </main>
                {viewState.detailsOpen ? (
                    <aside
                        className="qs-spatial-details"
                        aria-label={locConstants.spatialResults.detailsLabel}>
                        <h3>{locConstants.spatialResults.featureDetails}</h3>
                        {selectedFeature ? (
                            <dl>
                                <dt>{locConstants.spatialResults.sourceRow}</dt>
                                <dd>{selectedFeature.ordinal + 1}</dd>
                                <dt>{locConstants.spatialResults.status}</dt>
                                <dd>{selectedFeature.status}</dd>
                                <dt>{locConstants.spatialResults.kind}</dt>
                                <dd>{selectedFeature.kind ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.geometry}</dt>
                                <dd>{selectedFeature.geometryType ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.srid}</dt>
                                <dd>{selectedFeature.srid ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.layout}</dt>
                                <dd>{selectedFeature.layout ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.vertices}</dt>
                                <dd>{selectedFeature.vertices ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.parts}</dt>
                                <dd>{selectedFeature.parts ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.rings}</dt>
                                <dd>{selectedFeature.rings ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.envelope}</dt>
                                <dd>
                                    {selectedFeature.envelope
                                        ?.map((value) => value.toPrecision(8))
                                        .join(", ") ?? "—"}
                                </dd>
                                <dt>{locConstants.spatialResults.wkbBytes}</dt>
                                <dd>{selectedFeature.wkbBytes ?? "—"}</dd>
                                <dt>{locConstants.spatialResults.reason}</dt>
                                <dd>{selectedFeature.reason ?? "—"}</dd>
                            </dl>
                        ) : (
                            <p className="qs-muted">{locConstants.spatialResults.selectFeature}</p>
                        )}
                    </aside>
                ) : null}
            </div>
        </section>
    );
}

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
import { SpatialMap } from "./SpatialMap";
import type { SpatialDecodeResponse, SpatialDecodedFeature } from "./spatialWorkerProtocol";

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
    initialViewState?: QsSpatialPanelViewState;
    onViewStateChange?: (state: QsSpatialPanelViewState) => void;
}

type LoadState =
    | { kind: "idle" }
    | { kind: "loading"; scanned: number; total: number }
    | { kind: "ready"; scanned: number; total: number }
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
            reject(new Error(event.message || "Spatial decode worker failed."));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "decode", generation, sequence, features });
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
            aria-label="Spatial features"
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
                            {feature.label || `Row ${feature.ordinal + 1}`}
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
        const worker = new Worker(new URL("spatialDecodeWorker.js", document.baseURI), {
            type: "module",
        });
        setFeatures([]);
        setLoadState({ kind: "loading", scanned: 0, total: selectedColumn.totalRows });
        updateState({
            selectedColumn: {
                resultSetId: selectedColumn.resultSetId,
                columnOrdinal: selectedColumn.columnOrdinal,
            },
        });
        const load = async () => {
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
                throw new Error(opened.error ?? "Spatial session could not be opened.");
            }
            handle = opened.handle;
            generation = opened.generation;
            let sequence = 0;
            let scanned = 0;
            while (!canceled) {
                const chunk = await props.rpc.sendRequest<QsSpatialNextParams, QsSpatialNextResult>(
                    QsSpatialNextRequest.type,
                    { handle, generation, sequence },
                );
                if (chunk.error) throw new Error(chunk.error);
                perfMark("mssql.queryResults.spatial.decode.begin", {
                    sequence,
                    rows: chunk.features.length,
                });
                const decoded = await workerDecode(
                    worker,
                    chunk.generation,
                    chunk.sequence,
                    chunk.features,
                );
                if (canceled) return;
                perfMark("mssql.queryResults.spatial.decode.end", {
                    sequence,
                    rows: decoded.decoded,
                    unsupported: decoded.unsupported,
                    errors: decoded.errors,
                    ms: Math.round(decoded.elapsedMs * 100) / 100,
                });
                setFeatures((current) => [...current, ...decoded.features]);
                scanned += chunk.scannedRows;
                setLoadState({
                    kind: chunk.done ? "ready" : "loading",
                    scanned,
                    total: opened.totalRows,
                });
                if (chunk.done) {
                    void perfMarkAfterNextPaint("mssql.queryResults.spatial.render.settled", {
                        rows: scanned,
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
            worker.terminate();
            if (handle) {
                void props.rpc.sendRequest(QsSpatialCancelRequest.type, { handle, generation });
                void props.rpc.sendRequest(QsSpatialCloseRequest.type, { handle });
            }
            perfMark("mssql.queryResults.spatial.decode.cancel", { generation });
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
    const selectedFeature = features.find(
        (feature) => feature.ordinal === viewState.selectedRowOrdinal,
    );
    const labelCandidates = selectedColumn?.columns.filter(
        (column) => column.ordinal !== selectedColumn.columnOrdinal,
    );
    const readyCount = features.filter((feature) => feature.status === "ready").length;
    const unavailableCount = features.length - readyCount;

    if (!selectedColumn) {
        return <div className="qs-spatial-empty">No eligible spatial columns.</div>;
    }

    return (
        <section className="qs-spatial-root" aria-label="Spatial results analysis">
            <div className="qs-spatial-toolbar" role="toolbar" aria-label="Spatial controls">
                <label>
                    <span>Spatial column</span>
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
                    <span>Label</span>
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
                        <option value="">Row number</option>
                        {labelCandidates?.map((column) => (
                            <option key={column.ordinal} value={column.ordinal}>
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Color by</span>
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
                        <option value="">Geometry type</option>
                        {labelCandidates?.map((column) => (
                            <option key={column.ordinal} value={column.ordinal}>
                                {column.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Group</span>
                    <select
                        value={viewState.groupBy}
                        onChange={(event) =>
                            updateState({
                                groupBy: event.target.value as QsSpatialPanelViewState["groupBy"],
                            })
                        }>
                        <option value="none">None</option>
                        <option value="srid">SRID</option>
                        <option value="geometryType">Geometry type</option>
                    </select>
                </label>
                <button type="button" className="qs-btn" onClick={() => setFitNonce((n) => n + 1)}>
                    <span className="codicon codicon-screen-full" aria-hidden="true" /> Fit
                </button>
            </div>
            <div className="qs-spatial-facts" aria-live="polite">
                <span>{selectedColumn.kind.toUpperCase()}</span>
                <span>{readyCount.toLocaleString()} renderable</span>
                <span>{unavailableCount.toLocaleString()} null / unsupported</span>
                <span>
                    {loadState.kind === "loading" || loadState.kind === "ready"
                        ? `${loadState.scanned.toLocaleString()} / ${loadState.total.toLocaleString()} rows`
                        : loadState.kind === "error"
                          ? loadState.message
                          : "Waiting"}
                </span>
                <span>Offline · no basemap requests</span>
            </div>
            <div className="qs-spatial-body">
                {viewState.listOpen ? (
                    <aside className="qs-spatial-sidebar">
                        <div className="qs-spatial-filter-row">
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
                                        ? "Null"
                                        : key === "showEmpty"
                                          ? "Empty"
                                          : "Unsupported"}
                                </label>
                            ))}
                        </div>
                        <VirtualFeatureList
                            features={filteredFeatures}
                            selected={viewState.selectedRowOrdinal}
                            onSelect={(selectedRowOrdinal) => updateState({ selectedRowOrdinal })}
                            initialScrollTop={viewState.listScrollTop}
                            onScroll={(listScrollTop) => updateState({ listScrollTop })}
                        />
                    </aside>
                ) : null}
                <main className="qs-spatial-map-region">
                    <SpatialMap
                        features={filteredFeatures}
                        selectedOrdinal={viewState.selectedRowOrdinal}
                        onSelect={(selectedRowOrdinal) => updateState({ selectedRowOrdinal })}
                        initialCamera={viewState.camera}
                        onCameraChange={(camera) => updateState({ camera })}
                        fitNonce={fitNonce}
                    />
                    {loadState.kind === "loading" ? (
                        <div className="qs-spatial-progress" role="status">
                            Loading {loadState.scanned.toLocaleString()} of{" "}
                            {loadState.total.toLocaleString()}…
                        </div>
                    ) : null}
                </main>
                {viewState.detailsOpen ? (
                    <aside
                        className="qs-spatial-details"
                        aria-label="Selected spatial feature details">
                        <h3>Feature details</h3>
                        {selectedFeature ? (
                            <dl>
                                <dt>Source row</dt>
                                <dd>{selectedFeature.ordinal + 1}</dd>
                                <dt>Status</dt>
                                <dd>{selectedFeature.status}</dd>
                                <dt>Kind</dt>
                                <dd>{selectedFeature.kind ?? "—"}</dd>
                                <dt>Geometry</dt>
                                <dd>{selectedFeature.geometryType ?? "—"}</dd>
                                <dt>SRID</dt>
                                <dd>{selectedFeature.srid ?? "—"}</dd>
                                <dt>Layout</dt>
                                <dd>{selectedFeature.layout ?? "—"}</dd>
                                <dt>Vertices</dt>
                                <dd>{selectedFeature.vertices ?? "—"}</dd>
                                <dt>WKB bytes</dt>
                                <dd>{selectedFeature.wkbBytes ?? "—"}</dd>
                                <dt>Reason</dt>
                                <dd>{selectedFeature.reason ?? "—"}</dd>
                            </dl>
                        ) : (
                            <p className="qs-muted">Select a feature on the map or in the list.</p>
                        )}
                    </aside>
                ) : null}
            </div>
        </section>
    );
}

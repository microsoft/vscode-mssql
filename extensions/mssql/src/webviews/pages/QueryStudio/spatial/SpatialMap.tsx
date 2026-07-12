/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import VectorImageLayer from "ol/layer/VectorImage.js";
import WebGLPointsLayer from "ol/layer/WebGLPoints.js";
import VectorSource from "ol/source/Vector.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style.js";
import type { SpatialDecodedFeature } from "./spatialWorkerProtocol";
import { perfMark } from "../../../common/perfMarks";
import { locConstants } from "../../../common/locConstants";

export interface SpatialMapProps {
    features: readonly SpatialDecodedFeature[];
    selectedOrdinal?: number;
    onSelect(ordinal: number): void;
    initialCamera?: { centerX: number; centerY: number; zoom: number; rotation: number };
    onCameraChange(camera: {
        centerX: number;
        centerY: number;
        zoom: number;
        rotation: number;
    }): void;
    fitNonce: number;
    renderer: "auto" | "canvas" | "gpuPoints";
}

const GPU_POINT_THRESHOLD = 10_000;

function themeColor(variable: string): string {
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue(variable).trim() || style.color;
}

function hashCategory(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function SpatialMap(props: SpatialMapProps): React.JSX.Element {
    const targetRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<Map | undefined>(undefined);
    const sourceRef = React.useRef<VectorSource<Feature> | undefined>(undefined);
    const canvasLayerRef = React.useRef<VectorImageLayer<VectorSource<Feature>> | undefined>(
        undefined,
    );
    const gpuLayerRef = React.useRef<WebGLPointsLayer<VectorSource<Feature>> | undefined>(
        undefined,
    );
    const tierRef = React.useRef<"canvas" | "gpuPoints">("canvas");
    const loadedRef = React.useRef(new Set<number>());
    const previousInputRef = React.useRef<readonly SpatialDecodedFeature[]>([]);
    const propsRef = React.useRef(props);
    propsRef.current = props;
    const firstPaintRef = React.useRef(false);
    const renderBeginRef = React.useRef(false);

    React.useLayoutEffect(() => {
        if (!targetRef.current) return;
        const palette = [
            "--vscode-charts-blue",
            "--vscode-charts-orange",
            "--vscode-charts-green",
            "--vscode-charts-purple",
            "--vscode-charts-yellow",
            "--vscode-charts-red",
        ].map(themeColor);
        const normalStyles = palette.map(
            (color) =>
                new Style({
                    fill: new Fill({ color }),
                    stroke: new Stroke({
                        color: themeColor("--vscode-editor-foreground"),
                        width: 1,
                    }),
                    image: new CircleStyle({
                        radius: 4,
                        fill: new Fill({ color }),
                        stroke: new Stroke({
                            color: themeColor("--vscode-editor-foreground"),
                            width: 1,
                        }),
                    }),
                }),
        );
        const selected = new Style({
            fill: new Fill({ color: themeColor("--vscode-list-activeSelectionBackground") }),
            stroke: new Stroke({ color: themeColor("--vscode-focusBorder"), width: 3 }),
            image: new CircleStyle({
                radius: 7,
                fill: new Fill({ color: themeColor("--vscode-list-activeSelectionBackground") }),
                stroke: new Stroke({ color: themeColor("--vscode-focusBorder"), width: 3 }),
            }),
        });
        const source = new VectorSource<Feature>({ useSpatialIndex: true });
        // VectorImage keeps panning/zooming responsive by reusing a rendered
        // image while interaction is active, then refreshes at rest.
        const layer = new VectorImageLayer({
            source,
            imageRatio: 1.25,
            style: (feature) =>
                feature.get("ordinal") === propsRef.current.selectedOrdinal
                    ? selected
                    : normalStyles[feature.get("colorIndex") ?? 0],
        });
        const gpuLayer = new WebGLPointsLayer({
            source,
            visible: false,
            variables: { selectedOrdinal: props.selectedOrdinal ?? -1 },
            style: {
                "circle-radius": [
                    "case",
                    ["==", ["get", "ordinal"], ["var", "selectedOrdinal"]],
                    7,
                    4,
                ],
                "circle-fill-color": [
                    "match",
                    ["get", "colorIndex"],
                    0,
                    palette[0],
                    1,
                    palette[1],
                    2,
                    palette[2],
                    3,
                    palette[3],
                    4,
                    palette[4],
                    palette[5],
                ],
                "circle-stroke-color": themeColor("--vscode-editor-foreground"),
                "circle-stroke-width": [
                    "case",
                    ["==", ["get", "ordinal"], ["var", "selectedOrdinal"]],
                    3,
                    1,
                ],
            },
        });
        const camera = props.initialCamera;
        const view = new View({
            center: camera ? [camera.centerX, camera.centerY] : [0, 0],
            zoom: camera?.zoom ?? 2,
            rotation: camera?.rotation ?? 0,
            constrainResolution: false,
        });
        const map = new Map({
            target: targetRef.current,
            layers: [layer, gpuLayer],
            view,
            controls: defaultControls({ attribution: false, rotate: false, zoom: false }),
            pixelRatio: Math.min(devicePixelRatio, 2),
        });
        map.on("singleclick", (event) => {
            const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, {
                hitTolerance: 5,
            });
            const ordinal = feature?.get("ordinal");
            if (typeof ordinal === "number") {
                propsRef.current.onSelect(ordinal);
            }
        });
        map.on("moveend", () => {
            const center = view.getCenter();
            if (center) {
                propsRef.current.onCameraChange({
                    centerX: center[0],
                    centerY: center[1],
                    zoom: view.getZoom() ?? 2,
                    rotation: view.getRotation(),
                });
                perfMark("mssql.queryResults.spatial.interaction.end", {
                    action: "panOrZoom",
                    tier: tierRef.current,
                    frames: 0,
                    p95FrameMs: 0,
                    inputDelayMs: 0,
                });
            }
        });
        map.on("rendercomplete", () => {
            if (!firstPaintRef.current && source.getFeatures().length > 0) {
                firstPaintRef.current = true;
                perfMark("mssql.queryResults.spatial.render.firstPaint", {
                    tier: tierRef.current,
                    features: source.getFeatures().length,
                    vertices: propsRef.current.features.reduce(
                        (total, feature) => total + (feature.vertices ?? 0),
                        0,
                    ),
                    partial: "true",
                    rafThrottled: 0,
                });
            }
        });
        mapRef.current = map;
        sourceRef.current = source;
        canvasLayerRef.current = layer;
        gpuLayerRef.current = gpuLayer;
        const observer = new ResizeObserver(() => map.updateSize());
        observer.observe(targetRef.current);
        return () => {
            observer.disconnect();
            map.setTarget(undefined);
            source.clear(true);
            map.dispose();
            gpuLayer.dispose();
            mapRef.current = undefined;
            sourceRef.current = undefined;
            canvasLayerRef.current = undefined;
            gpuLayerRef.current = undefined;
            loadedRef.current.clear();
            perfMark("mssql.queryResults.spatial.render.cancel", { reason: "unmount" });
        };
    }, []);

    React.useEffect(() => {
        const source = sourceRef.current;
        const map = mapRef.current;
        if (!source || !map) return;
        const reader = new GeoJSON();
        const added: Feature[] = [];
        const previous = previousInputRef.current;
        const isAppend =
            props.features.length >= previous.length &&
            (previous.length === 0 ||
                props.features[previous.length - 1]?.ordinal ===
                    previous[previous.length - 1]?.ordinal);
        if (!isAppend) {
            source.clear(true);
            loadedRef.current.clear();
        }
        const pending = isAppend ? props.features.slice(previous.length) : props.features;
        previousInputRef.current = props.features;
        for (const decoded of pending) {
            if (
                decoded.status !== "ready" ||
                !decoded.geometry ||
                loadedRef.current.has(decoded.ordinal)
            ) {
                continue;
            }
            try {
                const feature = reader.readFeature(
                    { type: "Feature", geometry: decoded.geometry, properties: {} },
                    {
                        dataProjection:
                            decoded.projection === "EPSG:4326" ? "EPSG:4326" : "EPSG:3857",
                        featureProjection: "EPSG:3857",
                    },
                ) as Feature;
                feature.set("ordinal", decoded.ordinal, true);
                const category = decoded.colorValue ?? decoded.geometryType ?? "Spatial";
                feature.set("colorIndex", hashCategory(category) % 6, true);
                added.push(feature);
                loadedRef.current.add(decoded.ordinal);
            } catch {
                // Worker status remains the source of truth; one malformed
                // geometry cannot prevent later features rendering.
            }
        }
        if (added.length > 0) {
            source.addFeatures(added);
            const allPoints = source
                .getFeatures()
                .every((feature) => feature.getGeometry()?.getType() === "Point");
            const useGpu =
                allPoints &&
                (props.renderer === "gpuPoints" ||
                    (props.renderer === "auto" &&
                        source.getFeatures().length >= GPU_POINT_THRESHOLD));
            tierRef.current = useGpu ? "gpuPoints" : "canvas";
            canvasLayerRef.current?.setVisible(!useGpu);
            gpuLayerRef.current?.setVisible(useGpu);
            if (!renderBeginRef.current) {
                renderBeginRef.current = true;
                perfMark("mssql.queryResults.spatial.render.begin", {
                    tier: tierRef.current,
                    offline: "true",
                });
            }
            if (loadedRef.current.size === added.length && !props.initialCamera) {
                const extent = source.getExtent();
                if (extent) {
                    map.getView().fit(extent, {
                        padding: [28, 28, 28, 28],
                        maxZoom: 16,
                        duration: 0,
                    });
                }
            }
        }
    }, [props.features, props.renderer]);

    React.useEffect(() => {
        sourceRef.current?.changed();
        gpuLayerRef.current?.updateStyleVariables({
            selectedOrdinal: props.selectedOrdinal ?? -1,
        });
    }, [props.selectedOrdinal]);

    React.useEffect(() => {
        const map = mapRef.current;
        const source = sourceRef.current;
        if (map && source && !source.isEmpty()) {
            const extent = source.getExtent();
            if (extent) {
                map.getView().fit(extent, {
                    padding: [28, 28, 28, 28],
                    maxZoom: 16,
                    duration: 180,
                });
            }
        }
    }, [props.fitNonce]);

    return (
        <div className="qs-spatial-map-shell">
            <div
                ref={targetRef}
                className="qs-spatial-map"
                aria-label={locConstants.spatialResults.featureMapLabel}
            />
            <div
                className="qs-spatial-map-controls"
                role="group"
                aria-label={locConstants.spatialResults.mapZoomControlsLabel}>
                <button
                    type="button"
                    aria-label={locConstants.spatialResults.zoomIn}
                    onClick={() => {
                        const view = mapRef.current?.getView();
                        if (view) view.animate({ zoom: (view.getZoom() ?? 2) + 1, duration: 120 });
                    }}>
                    <span className="codicon codicon-add" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label={locConstants.spatialResults.zoomOut}
                    onClick={() => {
                        const view = mapRef.current?.getView();
                        if (view) view.animate({ zoom: (view.getZoom() ?? 2) - 1, duration: 120 });
                    }}>
                    <span className="codicon codicon-remove" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

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
import Cluster from "ol/source/Cluster.js";
import VectorSource from "ol/source/Vector.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { Fill, Stroke, Style, Circle as CircleStyle, Text } from "ol/style.js";
import {
    resolveSpatialRendererTier,
    type SpatialDecodedFeature,
    type SpatialRendererChoice,
    type SpatialRendererTier,
} from "./spatialWorkerProtocol";
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
    renderer: SpatialRendererChoice;
}

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
    const clusterLayerRef = React.useRef<VectorImageLayer<Cluster<Feature>> | undefined>(undefined);
    const tierRef = React.useRef<SpatialRendererTier>("canvas");
    const loadedRef = React.useRef(new Set<number>());
    const featureCacheRef = React.useRef(new globalThis.Map<number, Feature>());
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
        const clusterSource = new Cluster<Feature>({
            source,
            distance: 36,
            minDistance: 12,
        });
        const clusterStyles = new globalThis.Map<string, Style>();
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
        const clusterLayer = new VectorImageLayer({
            source: clusterSource,
            visible: false,
            imageRatio: 1.2,
            style: (clusterFeature) => {
                const members = (clusterFeature.get("features") as Feature[] | undefined) ?? [];
                if (members.length === 1) {
                    const member = members[0];
                    return member.get("ordinal") === propsRef.current.selectedOrdinal
                        ? selected
                        : normalStyles[member.get("colorIndex") ?? 0];
                }
                const containsSelection = members.some(
                    (member) => member.get("ordinal") === propsRef.current.selectedOrdinal,
                );
                const radius = Math.min(24, 9 + Math.log2(Math.max(2, members.length)) * 2);
                const key = `${members.length}:${containsSelection ? 1 : 0}`;
                let style = clusterStyles.get(key);
                if (!style) {
                    style = new Style({
                        image: new CircleStyle({
                            radius,
                            fill: new Fill({
                                color: containsSelection
                                    ? themeColor("--vscode-list-activeSelectionBackground")
                                    : palette[0],
                            }),
                            stroke: new Stroke({
                                color: containsSelection
                                    ? themeColor("--vscode-focusBorder")
                                    : themeColor("--vscode-editor-foreground"),
                                width: containsSelection ? 3 : 1.5,
                            }),
                        }),
                        text: new Text({
                            text: members.length.toLocaleString(),
                            fill: new Fill({ color: themeColor("--vscode-editor-background") }),
                            stroke: new Stroke({
                                color: themeColor("--vscode-editor-foreground"),
                                width: 1,
                            }),
                        }),
                    });
                    clusterStyles.set(key, style);
                }
                return style;
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
            layers: [layer, clusterLayer, gpuLayer],
            view,
            controls: defaultControls({ attribution: false, rotate: false, zoom: false }),
            pixelRatio: Math.min(devicePixelRatio, 2),
        });
        map.on("singleclick", (event) => {
            const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, {
                hitTolerance: 5,
            });
            const members = feature?.get("features") as Feature[] | undefined;
            if (members && members.length > 1) {
                const geometry = feature?.getGeometry() as
                    | { getCoordinates?: () => unknown }
                    | undefined;
                const coordinates = geometry?.getCoordinates?.();
                const center =
                    Array.isArray(coordinates) &&
                    typeof coordinates[0] === "number" &&
                    typeof coordinates[1] === "number"
                        ? ([coordinates[0], coordinates[1]] as [number, number])
                        : undefined;
                if (center !== undefined) {
                    view.animate({
                        center,
                        zoom: Math.min(18, (view.getZoom() ?? 2) + 2),
                        duration: 160,
                    });
                }
                return;
            }
            const ordinal = members?.[0]?.get("ordinal") ?? feature?.get("ordinal");
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
        clusterLayerRef.current = clusterLayer;
        const observer = new ResizeObserver(() => map.updateSize());
        observer.observe(targetRef.current);
        return () => {
            observer.disconnect();
            map.setTarget(undefined);
            source.clear(true);
            map.dispose();
            gpuLayer.dispose();
            clusterLayer.dispose();
            mapRef.current = undefined;
            sourceRef.current = undefined;
            canvasLayerRef.current = undefined;
            gpuLayerRef.current = undefined;
            clusterLayerRef.current = undefined;
            loadedRef.current.clear();
            featureCacheRef.current.clear();
            perfMark("mssql.queryResults.spatial.render.cancel", { reason: "unmount" });
        };
    }, []);

    React.useEffect(() => {
        const source = sourceRef.current;
        const map = mapRef.current;
        if (!source || !map) return;
        const reader = new GeoJSON();
        const desired = new Set<number>();
        for (const decoded of props.features) {
            if (decoded.status !== "ready" || !decoded.geometry) {
                continue;
            }
            desired.add(decoded.ordinal);
            if (featureCacheRef.current.has(decoded.ordinal)) continue;
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
                featureCacheRef.current.set(decoded.ordinal, feature);
            } catch {
                // Worker status remains the source of truth; one malformed
                // geometry cannot prevent later features rendering.
            }
        }
        const firstAcceptedBatch = loadedRef.current.size === 0 && desired.size > 0;
        for (const ordinal of loadedRef.current) {
            if (!desired.has(ordinal)) {
                const feature = featureCacheRef.current.get(ordinal);
                if (feature) source.removeFeature(feature);
            }
        }
        const added: Feature[] = [];
        for (const ordinal of desired) {
            if (!loadedRef.current.has(ordinal)) {
                const feature = featureCacheRef.current.get(ordinal);
                if (feature) added.push(feature);
            }
        }
        if (added.length > 0) source.addFeatures(added);
        loadedRef.current = desired;
        const sourceFeatures = source.getFeatures();
        if (sourceFeatures.length > 0) {
            const allPoints = sourceFeatures.every(
                (feature) => feature.getGeometry()?.getType() === "Point",
            );
            const tier = resolveSpatialRendererTier(
                allPoints,
                sourceFeatures.length,
                props.renderer,
            );
            tierRef.current = tier;
            canvasLayerRef.current?.setVisible(tier === "canvas");
            clusterLayerRef.current?.setVisible(tier === "clusters");
            gpuLayerRef.current?.setVisible(tier === "gpuPoints");
            if (!renderBeginRef.current) {
                renderBeginRef.current = true;
                perfMark("mssql.queryResults.spatial.render.begin", {
                    tier: tierRef.current,
                    offline: "true",
                });
            }
            if (firstAcceptedBatch && !props.initialCamera) {
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
        clusterLayerRef.current?.changed();
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

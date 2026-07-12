/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style.js";
import type { SpatialDecodedFeature } from "./spatialWorkerProtocol";
import { perfMark } from "../../../common/perfMarks";

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
}

function themeColor(variable: string): string {
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue(variable).trim() || style.color;
}

export function SpatialMap(props: SpatialMapProps): React.JSX.Element {
    const targetRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<Map | undefined>(undefined);
    const sourceRef = React.useRef<VectorSource<Feature> | undefined>(undefined);
    const loadedRef = React.useRef(new Set<number>());
    const propsRef = React.useRef(props);
    propsRef.current = props;
    const firstPaintRef = React.useRef(false);

    React.useLayoutEffect(() => {
        if (!targetRef.current) return;
        const normal = new Style({
            fill: new Fill({ color: themeColor("--vscode-charts-blue") }),
            stroke: new Stroke({ color: themeColor("--vscode-editor-foreground"), width: 1 }),
            image: new CircleStyle({
                radius: 4,
                fill: new Fill({ color: themeColor("--vscode-charts-blue") }),
                stroke: new Stroke({ color: themeColor("--vscode-editor-foreground"), width: 1 }),
            }),
        });
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
        const layer = new VectorLayer({
            source,
            updateWhileAnimating: false,
            updateWhileInteracting: false,
            style: (feature) =>
                feature.get("ordinal") === propsRef.current.selectedOrdinal ? selected : normal,
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
            layers: [layer],
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
                    interaction: "move",
                    rendered: source.getFeatures().length,
                });
            }
        });
        map.on("rendercomplete", () => {
            if (!firstPaintRef.current && source.getFeatures().length > 0) {
                firstPaintRef.current = true;
                perfMark("mssql.queryResults.spatial.render.firstPaint", {
                    rendered: source.getFeatures().length,
                });
            }
        });
        mapRef.current = map;
        sourceRef.current = source;
        const observer = new ResizeObserver(() => map.updateSize());
        observer.observe(targetRef.current);
        perfMark("mssql.queryResults.spatial.render.begin", { renderer: "canvas" });
        return () => {
            observer.disconnect();
            map.setTarget(undefined);
            source.clear(true);
            map.dispose();
            mapRef.current = undefined;
            sourceRef.current = undefined;
            loadedRef.current.clear();
            perfMark("mssql.queryResults.spatial.render.cancel", {
                rendered: source.getFeatures().length,
            });
        };
    }, []);

    React.useEffect(() => {
        const source = sourceRef.current;
        const map = mapRef.current;
        if (!source || !map) return;
        const reader = new GeoJSON();
        const added: Feature[] = [];
        for (const decoded of props.features) {
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
                added.push(feature);
                loadedRef.current.add(decoded.ordinal);
            } catch {
                // Worker status remains the source of truth; one malformed
                // geometry cannot prevent later features rendering.
            }
        }
        if (added.length > 0) {
            source.addFeatures(added);
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
    }, [props.features]);

    React.useEffect(() => {
        sourceRef.current?.changed();
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
            <div ref={targetRef} className="qs-spatial-map" aria-label="Spatial feature map" />
            <div className="qs-spatial-map-controls" role="group" aria-label="Map zoom controls">
                <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => {
                        const view = mapRef.current?.getView();
                        if (view) view.animate({ zoom: (view.getZoom() ?? 2) + 1, duration: 120 });
                    }}>
                    <span className="codicon codicon-add" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label="Zoom out"
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

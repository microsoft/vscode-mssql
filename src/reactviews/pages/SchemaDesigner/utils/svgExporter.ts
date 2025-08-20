/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Node, Edge } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export interface SvgExportOptions {
    width: number;
    height: number;
    backgroundColor?: string;
}

/**
 * Escapes XML/SVG special characters in text
 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Generates a clean, standard-compliant SVG from React Flow nodes and edges
 */
export function generateSvgFromReactFlow(
    nodes: Node<SchemaDesigner.Table>[],
    edges: Edge[],
    options: SvgExportOptions,
): string {
    const { backgroundColor = "#1e1e1e" } = options;

    // Calculate bounds of all nodes to center the content
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((node) => {
        const nodeWidth = node.measured?.width || 200;
        const nodeHeight = node.measured?.height || 100;

        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + nodeWidth);
        maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Add padding
    const padding = 50;
    const contentWidth = maxX - minX + 2 * padding;
    const contentHeight = maxY - minY + 2 * padding;
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    // Start building SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${contentWidth}" height="${contentHeight}" 
     viewBox="0 0 ${contentWidth} ${contentHeight}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .table-header { fill: #ffffff; font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: bold; }
      .column-text { fill: #cccccc; font-family: 'Segoe UI', sans-serif; font-size: 12px; }
      .table-border { fill: none; stroke: #3c3c3c; stroke-width: 1; }
      .table-background { fill: #252526; }
      .header-background { fill: #007acc; }
      .primary-key { fill: #ffd700; font-weight: bold; }
      .foreign-key { fill: #ff6b6b; }
      .relationship-line { stroke: #666666; stroke-width: 2; fill: none; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="${backgroundColor}"/>
`;

    // Generate edges (relationships) first so they appear behind nodes
    edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);

        if (sourceNode && targetNode) {
            const sourceX =
                sourceNode.position.x + offsetX + (sourceNode.measured?.width || 200) / 2;
            const sourceY =
                sourceNode.position.y + offsetY + (sourceNode.measured?.height || 100) / 2;
            const targetX =
                targetNode.position.x + offsetX + (targetNode.measured?.width || 200) / 2;
            const targetY =
                targetNode.position.y + offsetY + (targetNode.measured?.height || 100) / 2;

            svg += `  <line x1="${sourceX}" y1="${sourceY}" x2="${targetX}" y2="${targetY}" class="relationship-line"/>\n`;
        }
    });

    // Generate nodes (tables)
    nodes.forEach((node) => {
        if (!node.data) return;

        const x = node.position.x + offsetX;
        const y = node.position.y + offsetY;
        const nodeWidth = node.measured?.width || 200;
        const nodeHeight = node.measured?.height || 100;
        const table = node.data;

        // Table background
        svg += `  <rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" class="table-background table-border"/>\n`;

        // Table header
        const headerHeight = 30;
        svg += `  <rect x="${x}" y="${y}" width="${nodeWidth}" height="${headerHeight}" class="header-background"/>\n`;

        // Table name
        const tableName = `${table.schema}.${table.name}`;
        svg += `  <text x="${x + 10}" y="${y + 20}" class="table-header">${escapeXml(tableName)}</text>\n`;

        // Columns
        let currentY = y + headerHeight + 20;
        table.columns.forEach((column, index) => {
            const columnY = currentY + index * 18;

            // Column icon and text
            let columnClass = "column-text";
            let icon = "";

            if (column.isPrimaryKey) {
                columnClass = "primary-key";
                icon = "🔑 ";
            } else if (
                table.foreignKeys.some((fk) => fk.columns.some((fkCol) => fkCol === column.name))
            ) {
                columnClass = "foreign-key";
                icon = "🔗 ";
            }

            const columnText = `${icon}${column.name}: ${column.dataType}`;
            if (columnY < y + nodeHeight - 10) {
                // Only show if within node bounds
                svg += `  <text x="${x + 10}" y="${columnY}" class="${columnClass}">${escapeXml(columnText)}</text>\n`;
            }
        });
    });

    svg += "</svg>";
    return svg;
}

/**
 * Creates a data URL for the SVG content
 */
export function createSvgDataUrl(svgContent: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
}

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

    if (!nodes.length) {
        // Return a minimal SVG if no nodes are provided
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${backgroundColor}"/>
  <text x="200" y="150" text-anchor="middle" fill="#cccccc" font-family="'Segoe UI', sans-serif" font-size="16">No tables to display</text>
</svg>`;
    }

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

    // Start building SVG with optimized structure
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
    </style>`;

    // Add marker definitions only if there are edges
    if (edges.length > 0) {
        svg += `
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#666666"/>
    </marker>`;
    }

    svg += `
  </defs>
  <rect width="100%" height="100%" fill="${backgroundColor}"/>
`;

    // Generate edges (relationships) first so they appear behind nodes
    edges.forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);

        if (sourceNode && targetNode) {
            const sourceWidth = sourceNode.measured?.width || 200;
            const sourceHeight = sourceNode.measured?.height || 100;
            const targetWidth = targetNode.measured?.width || 200;
            const targetHeight = targetNode.measured?.height || 100;

            // Calculate edge connection points (center-to-center for now)
            const sourceX = sourceNode.position.x + offsetX + sourceWidth / 2;
            const sourceY = sourceNode.position.y + offsetY + sourceHeight / 2;
            const targetX = targetNode.position.x + offsetX + targetWidth / 2;
            const targetY = targetNode.position.y + offsetY + targetHeight / 2;

            svg += `  <line x1="${sourceX}" y1="${sourceY}" x2="${targetX}" y2="${targetY}" class="relationship-line" marker-end="url(#arrowhead)"/>\n`;
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

        // Columns - limit to visible columns to prevent performance issues
        let currentY = y + headerHeight + 15;
        const maxVisibleColumns = Math.floor((nodeHeight - headerHeight - 20) / 18);
        const visibleColumns = table.columns.slice(0, maxVisibleColumns);

        visibleColumns.forEach((column, index) => {
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

            // Truncate long column names/types for better display
            const maxColumnTextLength = Math.floor((nodeWidth - 40) / 7); // Approximate character width
            let columnText = `${icon}${column.name}: ${column.dataType}`;
            if (columnText.length > maxColumnTextLength) {
                columnText = columnText.substring(0, maxColumnTextLength - 3) + "...";
            }

            svg += `  <text x="${x + 10}" y="${columnY}" class="${columnClass}">${escapeXml(columnText)}</text>\n`;
        });

        // Add indicator if there are more columns
        if (table.columns.length > maxVisibleColumns) {
            const moreColumnsY = currentY + maxVisibleColumns * 18;
            const remainingCount = table.columns.length - maxVisibleColumns;
            svg += `  <text x="${x + 10}" y="${moreColumnsY}" class="column-text" font-style="italic">... and ${remainingCount} more columns</text>\n`;
        }
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared primitives for the Vector Workbench workspace views (VEC-6).
 * Rides the lazy vector chunk — nothing here may be imported by the shell
 * statically. House rules (briefs r01/r06): VS Code tokens only, 11px
 * UPPERCASE section labels, monospace numerics at 6 significant digits,
 * locale thousands separators, ≤2px radii.
 */

import * as React from "react";

export function formatCount(value: number): string {
    return value.toLocaleString("en-US");
}

/** 6 significant digits in tables (house rule R12); locale for big counts. */
export function formatStat(value: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    return Math.abs(value) >= 1000 ? value.toLocaleString("en-US") : value.toPrecision(6);
}

/** Signed short form for Δ / contribution bar values (+0.211 / −0.188). */
export function formatSigned(value: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    const magnitude = Math.abs(value);
    const text = magnitude === 0 ? "0" : magnitude.toPrecision(3);
    return `${value < 0 ? "−" : "+"}${text}`;
}

/** One percentage with a single decimal (truth banner: "PC1 18.4%"). */
export function formatPct(value: number): string {
    return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

/** Basket letters A..H (VECTOR_COMPARE_MAX_ROWS = 8). */
export const BASKET_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/** 11px uppercase section label with optional right-aligned provenance meta. */
export function VecSectionLabel(props: {
    children: React.ReactNode;
    right?: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="qs-vec-section-label">
            <span>{props.children}</span>
            {props.right !== undefined ? <span className="qs-vec-muted">{props.right}</span> : null}
        </div>
    );
}

/** Label/value property row (flat, hairline-separated — no cards). */
export function VecPropRow(props: {
    label: React.ReactNode;
    children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="qs-vec6-prop-row">
            <span className="qs-vec6-prop-label">{props.label}</span>
            <span className="qs-vec-num">{props.children}</span>
        </div>
    );
}

/** Resolve a --vscode-* token off a live element (theme-synced at call time). */
export function resolveToken(element: Element, token: string, fallback: string): string {
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    return value.length > 0 ? value : fallback;
}

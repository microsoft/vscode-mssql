/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio result widgets (RBS2-9 first renderer slice): consumers of
 * the RESOLVED presentation model only. Payloads arrive via bounded page
 * pulls through the controller (never in state); markdown renders as plain
 * text (no raw HTML — sanitization rule); unsupported kinds, expired
 * handles, pending and missing sources all degrade to explicit visible
 * states (total layout, never blank).
 */

import { useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { ResolvedWidget } from "../../../sharedInterfaces/runbookPresentation";
import { RbsFetchOutputPageRequest } from "../../../sharedInterfaces/runbookStudio";
import { useRbs } from "./state";

const PAGE_ROWS = 100;

interface FetchedPage {
    columns?: string[];
    rows?: Array<Array<string | number | boolean | null>>;
    totalRows?: number;
    errorCode?: string;
}

function usePage(handleId: string | undefined): FetchedPage | undefined {
    const { rpc } = useRbs();
    const [page, setPage] = useState<FetchedPage | undefined>(undefined);
    useEffect(() => {
        let cancelled = false;
        setPage(undefined);
        if (!handleId) {
            return;
        }
        void rpc
            .sendRequest(RbsFetchOutputPageRequest.type, {
                handleId,
                startRow: 0,
                rowCount: PAGE_ROWS,
            })
            .then((result) => {
                if (!cancelled) {
                    setPage({
                        ...(result.columns ? { columns: result.columns } : {}),
                        ...(result.rows ? { rows: result.rows } : {}),
                        ...(result.totalRows !== undefined ? { totalRows: result.totalRows } : {}),
                        ...(result.error ? { errorCode: result.error.code } : {}),
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [handleId]);
    return page;
}

function GridView({ page }: { page: FetchedPage }) {
    const loc = locConstants.runbookStudio;
    const rows = page.rows ?? [];
    return (
        <div className="rbs-widget-scroll">
            <table className="rbs-table">
                {page.columns ? (
                    <thead>
                        <tr>
                            {page.columns.map((column, i) => (
                                <th key={i}>{column}</th>
                            ))}
                        </tr>
                    </thead>
                ) : null}
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                                <td key={cellIndex} className="rbs-mono">
                                    {cell === null ? "NULL" : String(cell)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {page.totalRows !== undefined && page.totalRows > rows.length ? (
                <div className="rbs-muted">{loc.showingRows(rows.length, page.totalRows)}</div>
            ) : null}
        </div>
    );
}

function ScalarCardsView({ page }: { page: FetchedPage }) {
    // scalarSet pages arrive as name/value rows.
    const entries = (page.rows ?? []).map((row) => ({
        label: String(row[0] ?? ""),
        value: row[1] === null ? "NULL" : String(row[1]),
    }));
    return (
        <div className="rbs-cards">
            {entries.map((entry) => (
                <div className="rbs-card" key={entry.label}>
                    <div className="rbs-card-label">{entry.label}</div>
                    <div className="rbs-card-value">{entry.value}</div>
                </div>
            ))}
        </div>
    );
}

function TextView({ page, mono }: { page: FetchedPage; mono: boolean }) {
    const text = (page.rows ?? [])
        .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join(" "))
        .join("\n");
    return <pre className={`rbs-text-block ${mono ? "rbs-mono" : ""}`}>{text}</pre>;
}

function JsonView({ page }: { page: FetchedPage }) {
    return (
        <pre className="rbs-text-block rbs-mono">
            {JSON.stringify({ columns: page.columns, rows: page.rows }, undefined, 2)}
        </pre>
    );
}

export function ResolvedWidgetView({ widget }: { widget: ResolvedWidget }) {
    const loc = locConstants.runbookStudio;
    const page = usePage(widget.state === "ready" ? widget.handleId : undefined);

    let body: React.ReactNode;
    switch (widget.state) {
        case "pending":
            body = <div className="rbs-muted">{loc.widgetPending}</div>;
            break;
        case "noOutput":
            body = <div className="rbs-muted">{loc.noOutputsDetail}</div>;
            break;
        case "expired":
            body = <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
            break;
        case "sourceMissing":
            body = <div className="rbs-muted">{loc.widgetSourceMissing}</div>;
            break;
        case "ready": {
            if (!page) {
                body = <div className="rbs-muted">{loc.loading}</div>;
            } else if (page.errorCode) {
                body = <div className="rbs-muted">{loc.dataExpiredDetail}</div>;
            } else {
                switch (widget.view) {
                    case "grid":
                        body = <GridView page={page} />;
                        break;
                    case "scalar-cards":
                        body = <ScalarCardsView page={page} />;
                        break;
                    case "markdown":
                    case "log-view":
                        body = <TextView page={page} mono={widget.view === "log-view"} />;
                        break;
                    case "json":
                        body = <JsonView page={page} />;
                        break;
                    default:
                        // Honest degrade: registered-but-unimplemented kinds
                        // say so rather than rendering a blank panel.
                        body = (
                            <div className="rbs-muted">{loc.unsupportedRenderer(widget.view)}</div>
                        );
                }
            }
            break;
        }
    }

    return (
        <section className="rbs-widget" aria-label={widget.title}>
            <div className="rbs-widget-header">
                <span className="rbs-widget-title">{widget.title}</span>
                <span className="rbs-chip">{widget.view}</span>
                {widget.drift ? (
                    <span
                        className="rbs-chip rbs-chip-warn"
                        title={loc.driftDetail(widget.drift.requestedView)}>
                        {loc.driftBadge}
                    </span>
                ) : null}
                {widget.contract ? (
                    <span className="rbs-muted rbs-mono">{widget.contract}</span>
                ) : null}
            </div>
            {body}
        </section>
    );
}

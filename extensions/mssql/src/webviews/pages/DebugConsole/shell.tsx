/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Debug Console shell: 44px top bar, 210px grouped left rail, provenance card. */

import { useEffect, useState } from "react";
import { DcExportRequest } from "../../../sharedInterfaces/debugConsole";
import { DcPage, useDc } from "./state";
import { OverviewPage, TracePage, WaterfallPage } from "./pagesCore";
import {
    ConnectionsPage,
    ExportsPage,
    ObjectExplorerPage,
    QueryResultsPage,
    SettingsPage,
    SqlActivityPage,
} from "./pagesMore";
import { CompletionsPage } from "./completionsPage";
import { ReplayLabPage } from "./replayLabPage";
import { SqlDataPlanePage } from "./pagesSqlDataPlane";
import { HistoryPage } from "./pagesPerf";
import { PerfHistoryPage } from "./pagesPerfHistory";

const NAV: Array<{ group: string; items: Array<{ id: DcPage; label: string; icon: string }> }> = [
    {
        group: "Common",
        items: [
            { id: "overview", label: "Overview", icon: "◫" },
            { id: "trace", label: "Consolidated Trace", icon: "≣" },
            { id: "waterfall", label: "Waterfall", icon: "𝄜" },
            { id: "perf", label: "Perf Test History", icon: "∿" },
            { id: "history", label: "Session History", icon: "◷" },
            { id: "completions", label: "Completions", icon: "✦" },
            { id: "replay", label: "Replay Lab", icon: "⟳" },
        ],
    },
    {
        group: "Feature pages",
        items: [
            { id: "sql", label: "SQL Activity", icon: "⛁" },
            { id: "sqlDataPlane", label: "SQL Data Plane", icon: "⬡" },
            { id: "connections", label: "Connections", icon: "⌁" },
            { id: "query", label: "Query & Results", icon: "▶" },
            { id: "oe", label: "Object Explorer", icon: "⌥" },
        ],
    },
    {
        group: "Session",
        items: [
            { id: "exports", label: "Exports", icon: "⇩" },
            { id: "settings", label: "Settings", icon: "✲" },
        ],
    },
];

function CapturePopover({ onClose }: { onClose: () => void }) {
    const { captureMode, captureExpiresEpochMs, setCaptureMode } = useDc();
    const [reason, setReason] = useState("");
    return (
        <div
            style={{
                position: "absolute",
                top: 40,
                right: 130,
                zIndex: 30,
                width: 320,
                padding: 12,
                background: "var(--dc-panel)",
                border: "1px solid var(--dc-border)",
                borderRadius: 6,
                boxShadow: "0 6px 24px rgba(0,0,0,.3)",
            }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Session Diag capture</div>
            <div className="dc-muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                Capture is local-only and never uploaded. Secrets and connection strings are never
                persisted. Current mode: <b>{captureMode}</b>
                {captureMode === "full" && captureExpiresEpochMs
                    ? ` (reverts ${new Date(captureExpiresEpochMs).toLocaleTimeString()})`
                    : ""}
                .
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="dc-btn" onClick={() => (setCaptureMode("redacted"), onClose())}>
                    Redacted
                </button>
                <button className="dc-btn" onClick={() => (setCaptureMode("digest"), onClose())}>
                    Digest
                </button>
                <button className="dc-btn" onClick={() => (setCaptureMode("off"), onClose())}>
                    Off
                </button>
            </div>
            <div style={{ marginTop: 10, borderTop: "1px solid var(--dc-border)", paddingTop: 8 }}>
                <div className="dc-muted" style={{ marginBottom: 6 }}>
                    Elevated (full) capture may include SQL text and object names. Time-bounded,
                    auto-reverts, recorded in the session log.
                </div>
                <input
                    className="dc-mono"
                    style={{
                        width: "100%",
                        marginBottom: 6,
                        height: 26,
                        background: "var(--dc-input-bg)",
                        color: "var(--dc-text)",
                        border: "1px solid var(--dc-input-border)",
                        borderRadius: 5,
                        padding: "0 8px",
                    }}
                    placeholder="Reason (required)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
                <button
                    className="dc-btn warn-chip"
                    disabled={!reason}
                    onClick={() => {
                        setCaptureMode("full", reason, 15);
                        onClose();
                    }}>
                    Start elevated capture (15 min)
                </button>
            </div>
        </div>
    );
}

function TopBar() {
    const {
        sources,
        activeSourceId,
        setActiveSourceId,
        isLive,
        captureMode,
        captureExpiresEpochMs,
        liveGaps,
        backfillGap,
        search,
        setSearch,
        rpc,
        refreshSources,
        navigate,
    } = useDc();
    const [showCapture, setShowCapture] = useState(false);
    const [countdown, setCountdown] = useState("");

    useEffect(() => {
        if (captureMode !== "full" || !captureExpiresEpochMs) {
            setCountdown("");
            return;
        }
        const timer = setInterval(() => {
            const left = Math.max(0, captureExpiresEpochMs - Date.now());
            const minutes = Math.floor(left / 60000);
            const seconds = Math.floor((left % 60000) / 1000);
            setCountdown(`${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
        }, 1000);
        return () => clearInterval(timer);
    }, [captureMode, captureExpiresEpochMs]);

    const active = sources.find((s) => s.id === activeSourceId);
    const unresolvedGaps = liveGaps.filter((g) => g.backfillStatus !== "succeeded").length;
    const chipClass =
        captureMode === "off"
            ? "capture-off"
            : captureMode === "full"
              ? "capture-full"
              : "capture-on";
    const chipLabel =
        captureMode === "off"
            ? "Capture off"
            : captureMode === "full"
              ? `Full capture: ${countdown || "…"}`
              : `🔒 ${captureMode[0].toUpperCase()}${captureMode.slice(1)}`;

    return (
        <div className="dc-topbar">
            {/* Icon only — the tab title already says "MSSQL Debug Console". */}
            <div className="dc-title" title="MSSQL Debug Console" aria-label="MSSQL Debug Console">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                        d="M1 8h3l2-5 3 10 2-5h4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
            <select
                className="dc-session-select"
                value={activeSourceId}
                title={active?.label}
                onChange={(e) => setActiveSourceId(e.target.value)}
                onFocus={refreshSources}>
                {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                        {source.label}
                        {source.eventCount !== undefined ? ` · ${source.eventCount}` : ""}
                    </option>
                ))}
            </select>
            {/* Live is derived from the selected source (Current session = live). */}
            {isLive ? (
                <span
                    className="dc-muted"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11.5,
                    }}>
                    <span className="dc-live-dot" style={{ display: "inline-block" }} />
                    live
                </span>
            ) : null}
            <div className="spacer" />
            <div className="dc-search">
                <span aria-hidden>⌕</span>
                <input
                    placeholder="Search events, types, corr id, digests…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            navigate({ page: "trace" });
                        }
                    }}
                />
            </div>
            <button className={`dc-chip ${chipClass}`} onClick={() => setShowCapture((v) => !v)}>
                {chipLabel}
            </button>
            {unresolvedGaps > 0 ? (
                <button
                    className="dc-btn warn-chip"
                    title="Recover the dropped ranges from the session store journal"
                    onClick={() => {
                        for (const gap of liveGaps) {
                            if (
                                gap.backfillStatus === "notStarted" ||
                                gap.backfillStatus === "failed"
                            ) {
                                void backfillGap(gap);
                            }
                        }
                        navigate({ page: "trace" });
                    }}>
                    ⚠ Backfill {unresolvedGaps} gap{unresolvedGaps > 1 ? "s" : ""}
                </button>
            ) : null}
            <button
                className="dc-btn primary"
                onClick={() => {
                    void rpc.sendRequest(DcExportRequest.type, { sourceId: activeSourceId });
                }}>
                ⇩ Export
            </button>
            {showCapture ? <CapturePopover onClose={() => setShowCapture(false)} /> : null}
        </div>
    );
}

const NAV_COLLAPSE_KEY = "dc.nav.collapsed";

function LeftNav() {
    const { route, navigate, state } = useDc();
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try {
            return localStorage.getItem(NAV_COLLAPSE_KEY) === "1";
        } catch {
            return false;
        }
    });
    const toggle = () => {
        setCollapsed((current) => {
            try {
                localStorage.setItem(NAV_COLLAPSE_KEY, current ? "0" : "1");
            } catch {
                // localStorage unavailable: collapse is session-only
            }
            return !current;
        });
    };
    return (
        <nav className={`dc-leftnav ${collapsed ? "collapsed" : ""}`}>
            {NAV.map((group) => (
                <div className="dc-nav-group" key={group.group}>
                    {!collapsed ? <div className="dc-nav-group-label">{group.group}</div> : null}
                    {group.items.map((item) => (
                        <button
                            key={item.id}
                            className={`dc-nav-item ${route.page === item.id ? "active" : ""}`}
                            title={item.label}
                            onClick={() => navigate({ page: item.id })}>
                            <span aria-hidden style={{ width: 15, textAlign: "center" }}>
                                {item.icon}
                            </span>
                            {!collapsed ? item.label : null}
                        </button>
                    ))}
                </div>
            ))}
            <div style={{ flex: 1 }} />
            {!collapsed ? (
                <div className="dc-provenance" title="Session provenance">
                    <div className="label">PROVENANCE</div>
                    <div>mssql {state?.provenance.extensionVersion ?? "dev"}</div>
                    <div>vscode {state?.provenance.vscodeVersion ?? ""}</div>
                </div>
            ) : null}
            <button
                className="dc-nav-item dc-nav-collapse"
                title={collapsed ? "Expand navigation" : "Collapse navigation"}
                onClick={toggle}>
                <span aria-hidden style={{ width: 15, textAlign: "center" }}>
                    {collapsed ? "»" : "«"}
                </span>
                {!collapsed ? "Collapse" : null}
            </button>
        </nav>
    );
}

export function DebugConsoleApp() {
    const { route } = useDc();
    let page: React.ReactNode;
    switch (route.page) {
        case "overview":
            page = <OverviewPage />;
            break;
        case "trace":
            page = <TracePage />;
            break;
        case "waterfall":
            page = <WaterfallPage />;
            break;
        case "perf":
            page = <PerfHistoryPage />;
            break;
        case "history":
            page = <HistoryPage />;
            break;
        case "sql":
            page = <SqlActivityPage />;
            break;
        case "sqlDataPlane":
            page = <SqlDataPlanePage />;
            break;
        case "connections":
            page = <ConnectionsPage />;
            break;
        case "query":
            page = <QueryResultsPage />;
            break;
        case "oe":
            page = <ObjectExplorerPage />;
            break;
        case "exports":
            page = <ExportsPage />;
            break;
        case "settings":
            page = <SettingsPage />;
            break;
        case "completions":
            page = <CompletionsPage />;
            break;
        case "replay":
            page = <ReplayLabPage />;
            break;
        default:
            page = <OverviewPage />;
    }
    return (
        <div className="dc-shell">
            <TopBar />
            <LeftNav />
            <main className="dc-page">{page}</main>
        </div>
    );
}

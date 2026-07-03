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
    GatedPage,
    ObjectExplorerPage,
    QueryResultsPage,
    SettingsPage,
    SqlActivityPage,
} from "./pagesMore";
import { HistoryPage, PerfPage } from "./pagesPerf";

const NAV: Array<{ group: string; items: Array<{ id: DcPage; label: string; icon: string }> }> = [
    {
        group: "Common",
        items: [
            { id: "overview", label: "Overview", icon: "◫" },
            { id: "trace", label: "Consolidated Trace", icon: "≣" },
            { id: "waterfall", label: "Waterfall", icon: "𝄜" },
            { id: "perf", label: "Perf & Sessions", icon: "∿" },
            { id: "history", label: "History", icon: "◷" },
            { id: "completions", label: "Completions", icon: "✦" },
            { id: "replay", label: "Replay Lab", icon: "⟳" },
        ],
    },
    {
        group: "Feature pages",
        items: [
            { id: "sql", label: "SQL Activity", icon: "⛁" },
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
        setIsLive,
        captureMode,
        captureExpiresEpochMs,
        liveGaps,
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
            <div className="dc-title">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                        d="M1 8h3l2-5 3 10 2-5h4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                MSSQL Debug Console
            </div>
            <select
                className="dc-session-select"
                value={activeSourceId}
                title={active?.label}
                onChange={(e) => {
                    setActiveSourceId(e.target.value);
                    const source = sources.find((s) => s.id === e.target.value);
                    setIsLive(source?.kind === "liveSession");
                }}
                onFocus={refreshSources}>
                {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                        {source.label}
                        {source.eventCount !== undefined ? ` · ${source.eventCount}` : ""}
                    </option>
                ))}
            </select>
            <div className="dc-seg">
                <button
                    className={isLive ? "active" : ""}
                    onClick={() => setIsLive(true)}
                    disabled={active?.kind !== "liveSession"}>
                    <span
                        className="dc-live-dot"
                        style={{ display: "inline-block", marginRight: 5 }}
                    />
                    Live
                </button>
                <button
                    className={!isLive ? "active" : ""}
                    onClick={() => {
                        setIsLive(false);
                        navigate({ page: "history" });
                    }}>
                    History
                </button>
            </div>
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
                <button className="dc-btn warn-chip" onClick={() => navigate({ page: "trace" })}>
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

function LeftNav() {
    const { route, navigate, state } = useDc();
    return (
        <nav className="dc-leftnav">
            {NAV.map((group) => (
                <div className="dc-nav-group" key={group.group}>
                    <div className="dc-nav-group-label">{group.group}</div>
                    {group.items.map((item) => (
                        <button
                            key={item.id}
                            className={`dc-nav-item ${route.page === item.id ? "active" : ""}`}
                            onClick={() => navigate({ page: item.id })}>
                            <span aria-hidden style={{ width: 15, textAlign: "center" }}>
                                {item.icon}
                            </span>
                            {item.label}
                        </button>
                    ))}
                </div>
            ))}
            <div className="dc-provenance" title="Session provenance">
                <div className="label">PROVENANCE</div>
                <div>mssql {state?.provenance.extensionVersion ?? "dev"}</div>
                <div>vscode {state?.provenance.vscodeVersion ?? ""}</div>
            </div>
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
            page = <PerfPage />;
            break;
        case "history":
            page = <HistoryPage />;
            break;
        case "sql":
            page = <SqlActivityPage />;
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
            page = (
                <GatedPage
                    title="Completions"
                    body="The completions debug experience plugs into this host as a feature page. It migrates from the existing inline-completion debug view in a later iteration — live trace, multi-session analysis, and replay tags land here."
                />
            );
            break;
        case "replay":
            page = (
                <GatedPage
                    title="Replay Lab"
                    body="Replay-drive re-submits captured events with original or overridden config. It is gated until the completions replay adapter migrates into the host and STS2 replay hardening lands for service-backed features. Honest gating beats fake replay fidelity."
                />
            );
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

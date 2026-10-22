/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared Debug Console components: pills, KPI cards, redacted fields, tables,
 *  and the host-query hook every page uses. */

import { DependencyList, useCallback, useEffect, useState } from "react";
import { ClassifiedValue, DiagProcess, DiagStatus } from "../../../sharedInterfaces/debugConsole";

/** Message text for a rejected host request (never the raw object). */
export function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/**
 * Host query with the two guards every page needs:
 *  - stale-response guard: a response for an older set of deps never
 *    overwrites a newer selection (fast source/run switches, async disk reads);
 *  - error path: a rejected request renders as an error line instead of a
 *    permanent "Loading…" plus an unhandled rejection.
 * `fetcher` returning undefined means "nothing to load" (data resets).
 */
export function useRpcQuery<T>(
    fetcher: () => Promise<T> | undefined,
    deps: DependencyList,
): { data: T | undefined; error: string | undefined; loading: boolean; refresh: () => void } {
    const [data, setData] = useState<T | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick((t) => t + 1), []);
    useEffect(() => {
        let stale = false;
        const pending = fetcher();
        if (!pending) {
            setData(undefined);
            setError(undefined);
            setLoading(false);
            return;
        }
        setLoading(true);
        pending.then(
            (result) => {
                if (!stale) {
                    setData(result);
                    setError(undefined);
                    setLoading(false);
                }
            },
            (failure: unknown) => {
                if (!stale) {
                    setError(describeError(failure));
                    setLoading(false);
                }
            },
        );
        return () => {
            stale = true;
        };
        // deps are the caller's query inputs; the fetcher closure is rebuilt with them
        // eslint-disable-next-line
    }, [...deps, tick]);
    return { data, error, loading, refresh };
}

/** Inline error line for a failed host query (with optional retry). */
export function RpcError({ error, retry }: { error: string; retry?: () => void }) {
    return (
        <div className="dc-rpc-error" role="alert">
            <span className="dc-pill error">error</span>
            <span>{error}</span>
            {retry ? (
                <button className="dc-btn" onClick={retry}>
                    Retry
                </button>
            ) : null}
        </div>
    );
}

/**
 * Keyboard path for clickable rows and cards: focusable, announced as a
 * button, Enter/Space activate. Spread onto the element alongside onClick.
 */
export function activatable(onActivate: () => void): {
    tabIndex: number;
    role: string;
    onKeyDown: (e: React.KeyboardEvent) => void;
} {
    return {
        tabIndex: 0,
        role: "button",
        onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate();
            }
        },
    };
}

/** Link-styled real button (focusable, keyboard-activatable) for inline actions. */
export function LinkButton({
    onClick,
    children,
    style,
    title,
}: {
    onClick: () => void;
    children: React.ReactNode;
    style?: React.CSSProperties;
    title?: string;
}) {
    return (
        <button type="button" className="dc-link" style={style} title={title} onClick={onClick}>
            {children}
        </button>
    );
}

export const PROCESS_COLOR: Record<string, string> = {
    extensionHost: "var(--dc-proc-ext)",
    webview: "var(--dc-proc-webview)",
    renderer: "var(--dc-proc-webview)",
    sqlToolsService: "var(--dc-proc-sts)",
    sqlServer: "var(--dc-proc-sql)",
    driver: "var(--dc-proc-wire)",
    harness: "var(--dc-proc-harness)",
    system: "var(--dc-proc-system)",
    userAction: "var(--dc-proc-system)",
};

export const PROCESS_LABEL: Record<string, string> = {
    extensionHost: "Extension",
    webview: "Webview",
    renderer: "Renderer",
    sqlToolsService: "STS",
    sqlServer: "SQL Server",
    driver: "SQL / SMO calls",
    harness: "Harness",
    system: "System",
    userAction: "User action",
};

export function ProcessPill({ process }: { process: DiagProcess | string }) {
    const color = PROCESS_COLOR[process] ?? "var(--dc-proc-system)";
    return (
        <span
            className="dc-proc-pill"
            style={{
                color,
                background: `color-mix(in srgb, ${color} 13%, transparent)`,
            }}>
            <span className="dc-proc-dot" style={{ background: color }} />
            {PROCESS_LABEL[process] ?? process}
        </span>
    );
}

export function StatusPill({ status }: { status: DiagStatus | string }) {
    const cls =
        status === "ok"
            ? "ok"
            : status === "error"
              ? "error"
              : status === "warning"
                ? "warning"
                : "info";
    return <span className={`dc-pill ${cls}`}>{status}</span>;
}

export function Kpi({
    label,
    value,
    note,
    tone,
}: {
    label: string;
    value: string | number;
    note?: string;
    tone?: "ok" | "warn" | "error";
}) {
    return (
        <div className={`dc-kpi ${tone ?? ""}`}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
            {note ? <div className="note">{note}</div> : null}
        </div>
    );
}

/** Classified value renderer — the single place sensitive fields become UI. */
export function RedactedField({ value }: { value: ClassifiedValue }) {
    if (value.handling === "plain" || value.handling === "truncated") {
        return (
            <span className="dc-mono">
                {String(value.v ?? "")}
                {value.handling === "truncated" ? (
                    <span className="dc-muted">
                        {" "}
                        …(+{(value.len ?? 0) - String(value.v ?? "").length} chars)
                    </span>
                ) : null}
            </span>
        );
    }
    if (value.handling === "digest" || value.handling === "tokenized") {
        return (
            <span
                className="dc-redacted"
                title={`classification: ${value.cls} · handling: ${value.handling}`}>
                🔒 {value.cls}
                <span className="digest">{value.digest}</span>
            </span>
        );
    }
    return (
        <span
            className="dc-redacted"
            title={`classification: ${value.cls} · handling: ${value.handling}`}>
            🔒 {value.cls} {value.handling}
            {value.len !== undefined ? <span className="digest">({value.len} chars)</span> : null}
        </span>
    );
}

export function formatTime(epochMs: number): string {
    const date = new Date(epochMs);
    return (
        date.toLocaleTimeString(undefined, { hour12: false }) +
        "." +
        String(date.getMilliseconds()).padStart(3, "0")
    );
}

export function formatDuration(ms: number | undefined): string {
    if (ms === undefined) {
        return "";
    }
    if (ms >= 10_000) {
        return `${(ms / 1000).toFixed(2)}s`;
    }
    if (ms >= 1000) {
        return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms.toFixed(0)}ms`;
}

export function EmptyState({
    title,
    body,
    children,
}: {
    title: string;
    body: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="dc-empty">
            <h2>{title}</h2>
            <p>{body}</p>
            {children}
        </div>
    );
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
    return (
        <>
            <div className="dc-page-header">
                <h1 className="dc-page-title">{title}</h1>
            </div>
            {sub ? <p className="dc-page-sub">{sub}</p> : null}
        </>
    );
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList, makeStyles, shorthands, tokens } from "@fluentui/react-components";

export type InlineCompletionDebugTab = "live" | "sessions";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "42px",
        backgroundColor: "var(--vscode-editor-background)",
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    product: {
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: tokens.fontSizeBase200,
        ...shorthands.padding("0", "12px"),
        whiteSpace: "nowrap",
    },
    badge: {
        display: "inline-flex",
        alignItems: "center",
        minWidth: "20px",
        height: "18px",
        color: "var(--vscode-badge-foreground)",
        backgroundColor: "var(--vscode-badge-background)",
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        ...shorthands.borderRadius("999px"),
        ...shorthands.padding("0", "7px"),
        marginLeft: "6px",
    },
});

export function InlineCompletionDebugTabBar({
    activeTab,
    liveCount,
    traceCount,
    sessionEventCount,
    sessionsScanned,
    sessionsLoading,
    onTabChange,
}: {
    activeTab: InlineCompletionDebugTab;
    liveCount: number;
    traceCount: number;
    sessionEventCount: number;
    sessionsScanned: boolean;
    sessionsLoading: boolean;
    onTabChange: (tab: InlineCompletionDebugTab) => void;
}) {
    const classes = useStyles();
    const sessionsBadge = sessionsLoading
        ? "..."
        : sessionsScanned
          ? `${traceCount} traces · ${sessionEventCount} events`
          : "--";
    const sessionsBadgeTitle = sessionsScanned
        ? `${traceCount} included trace files, ${sessionEventCount} included events`
        : "Trace folder is scanned when the Sessions tab is opened.";
    return (
        <div className={classes.root}>
            <TabList
                selectedValue={activeTab}
                onTabSelect={(_, data) => onTabChange(data.value as InlineCompletionDebugTab)}>
                <Tab value="live">
                    Live <span className={classes.badge}>{liveCount}</span>
                </Tab>
                <Tab value="sessions">
                    Sessions{" "}
                    <span className={classes.badge} title={sessionsBadgeTitle}>
                        {sessionsBadge}
                    </span>
                </Tab>
            </TabList>
            <div className={classes.product}>vscode-mssql · copilot-completion-debug</div>
        </div>
    );
}

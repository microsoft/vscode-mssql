/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from "react";
import { makeStyles, shorthands } from "@fluentui/react-components";
import { InlineCompletionDebugPage } from "./inlineCompletionDebug";
import { InlineCompletionDebugTab, InlineCompletionDebugTabBar } from "./TabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { useInlineCompletionDebugSelector } from "./inlineCompletionDebugSelector";
import { ReplayTraceBuilder } from "./components/ReplayTraceBuilder";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
        ...shorthands.overflow("hidden"),
    },
    content: {
        ...shorthands.flex(1),
        minHeight: 0,
    },
    hidden: {
        display: "none",
    },
});

export function InlineCompletionDebugApp() {
    const classes = useStyles();
    const [activeTab, setActiveTab] = useState<InlineCompletionDebugTab>("live");
    const liveCount = useInlineCompletionDebugSelector((state) => state.events.length);
    const sessions = useInlineCompletionDebugSelector((state) => state.sessions);
    const includedTraceCount = useMemo(
        () => sessions.traceIndex.filter((entry) => entry.included).length,
        [sessions.traceIndex],
    );
    const sessionEventCount = useMemo(
        () =>
            sessions.traceIndex
                .filter((entry) => entry.included)
                .reduce((sum, entry) => sum + entry.eventCount, 0),
        [sessions.traceIndex],
    );
    const sessionsScanned =
        sessions.lastRefreshedAt !== undefined || sessions.traceIndex.length > 0;

    return (
        <div className={classes.root}>
            <InlineCompletionDebugTabBar
                activeTab={activeTab}
                liveCount={liveCount}
                traceCount={includedTraceCount}
                sessionEventCount={sessionEventCount}
                sessionsScanned={sessionsScanned}
                sessionsLoading={sessions.loading}
                onTabChange={setActiveTab}
            />
            <div className={activeTab === "live" ? classes.content : classes.hidden}>
                <InlineCompletionDebugPage />
            </div>
            <div className={activeTab === "sessions" ? classes.content : classes.hidden}>
                <SessionsTab active={activeTab === "sessions"} />
            </div>
            <ReplayTraceBuilder />
        </div>
    );
}

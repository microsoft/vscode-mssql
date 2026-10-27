/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    makeStyles,
    shorthands,
    Tab,
    TabList,
    Tooltip,
    tokens,
} from "@fluentui/react-components";
import { ArrowClockwise20Regular, Settings20Regular } from "@fluentui/react-icons";
import { useRef } from "react";
import { locConstants as loc } from "../../common/locConstants";
import { NavigationBreadcrumb } from "../../common/navigation/navigationBreadcrumb";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { RouteParams } from "../../common/navigation/router";
import { PerformanceDashboardDatabasePicker } from "./performanceDashboardDatabasePicker";
import { timeFormat } from "./performanceDashboardFormat";
import { PerformanceDashboardQueriesPage } from "./performanceDashboardQueriesPage";
import { PerformanceDashboardQueryPage } from "./performanceDashboardQueryPage";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardTimeRange, timeRangeRoutes } from "./performanceDashboardTimeRange";
import {
    PerformanceDashboardRoute,
    pageQuery,
    performanceDashboardRouter,
    performanceDashboardTabs,
    settingsSectionOf,
    withSettings,
} from "./performanceDashboardRoutes";
import { PerformanceDashboardSettingsDrawer } from "./performanceDashboardSettingsDrawer";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
        backgroundColor: "var(--vscode-editor-background)",
    },
    header: {
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("16px"),
        ...shorthands.padding("16px", "24px", "8px"),
        minWidth: 0,
    },
    spacer: {
        flexGrow: 1,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        ...shorthands.gap("12px"),
    },
    updated: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
    },
    tabs: {
        // The tabs have their own padding, so the labels line up with the toolbar.
        ...shorthands.padding("0", "14px"),
    },
    content: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
        flexGrow: 1,
        ...shorthands.overflow("auto"),
        // A scroll bar that comes and goes would resize the charts in a loop.
        scrollbarGutter: "stable",
        ...shorthands.padding("16px", "24px"),
    },
});

export const PerformanceDashboardPage = () => {
    const classes = useStyles();
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { refresh, updatedAt } = useRefresh();
    const settingsSection = settingsSectionOf(match);
    const topRoute = router.topRoute(match);
    const isTopRoute = match.route.id === topRoute.id;

    // A tab keeps its options, such as its time range, when the user comes back to it.
    const tabQueries = useRef<Record<string, RouteParams>>({});
    if (isTopRoute) {
        tabQueries.current[topRoute.id] = pageQuery(match);
    }

    return (
        <div className={classes.root}>
            <header className={classes.header}>
                <div className={classes.toolbar}>
                    <PerformanceDashboardDatabasePicker />
                    <span className={classes.spacer} />
                    <div className={classes.actions}>
                        {timeRangeRoutes.has(match.route.id) && <PerformanceDashboardTimeRange />}
                        <Caption1 className={classes.updated}>
                            {loc.performanceDashboard.updatedAt(timeFormat.format(updatedAt))}
                        </Caption1>
                        <Tooltip content={loc.common.refresh} relationship="label">
                            <Button
                                appearance="subtle"
                                icon={<ArrowClockwise20Regular />}
                                onClick={refresh}
                            />
                        </Tooltip>
                        <Tooltip content={loc.performanceDashboard.settings} relationship="label">
                            <Button
                                appearance="subtle"
                                icon={<Settings20Regular />}
                                aria-haspopup="dialog"
                                onClick={() => navigate(withSettings(match, "queryStore"))}
                            />
                        </Tooltip>
                    </div>
                </div>
                {/* With one tab, such as Queries for now, the tab list is hidden. */}
                {performanceDashboardTabs.length > 1 && (
                    <TabList
                        className={classes.tabs}
                        selectedValue={topRoute.id}
                        onTabSelect={(_event, data) => {
                            const tabId = String(data.value);
                            navigate(router.build(tabId, {}, tabQueries.current[tabId]));
                        }}>
                        {performanceDashboardTabs.map((tab) => (
                            <Tab key={tab.id} value={tab.id}>
                                {tab.title(performanceDashboardRouter.match(tab.path)!)}
                            </Tab>
                        ))}
                    </TabList>
                )}
            </header>
            <main className={classes.content}>
                {/* Below a tab, the breadcrumb shows the way back up, for example from a deep link. */}
                {!isTopRoute && <NavigationBreadcrumb />}
                {match.route.id === "query" ? (
                    <PerformanceDashboardQueryPage />
                ) : (
                    <PerformanceDashboardQueriesPage />
                )}
            </main>
            {settingsSection && (
                <PerformanceDashboardSettingsDrawer
                    section={settingsSection}
                    onClose={() => navigate(withSettings(match, undefined))}
                />
            )}
        </div>
    );
};

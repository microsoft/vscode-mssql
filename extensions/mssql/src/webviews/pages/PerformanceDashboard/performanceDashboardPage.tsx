/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands, Tab, TabList, Title3 } from "@fluentui/react-components";
import { locConstants as loc } from "../../common/locConstants";
import { NavigationBreadcrumb } from "../../common/navigation/navigationBreadcrumb";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { PerformanceDashboardDatabasePicker } from "./performanceDashboardDatabasePicker";
import {
    PerformanceDashboardRoute,
    performanceDashboardRouter,
    performanceDashboardTabs,
} from "./performanceDashboardRoutes";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
        backgroundColor: "var(--vscode-editor-background)",
    },
    navigationBar: {
        display: "flex",
        alignItems: "center",
        ...shorthands.padding("4px", "12px", "0"),
        minWidth: 0,
    },
    breadcrumb: {
        minWidth: 0,
    },
    tabs: {
        ...shorthands.padding("0", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    content: {
        flexGrow: 1,
        ...shorthands.overflow("auto"),
        ...shorthands.padding("16px", "20px"),
    },
    title: {
        color: "var(--vscode-foreground)",
        ...shorthands.margin(0),
    },
});

export const PerformanceDashboardPage = () => {
    const classes = useStyles();
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();

    return (
        <div className={classes.root}>
            <nav className={classes.navigationBar} aria-label={loc.performanceDashboard.title}>
                <NavigationBreadcrumb
                    className={classes.breadcrumb}
                    root={<PerformanceDashboardDatabasePicker />}
                />
            </nav>
            <TabList
                className={classes.tabs}
                size="small"
                selectedValue={router.topRoute(match).id}
                onTabSelect={(_event, data) => navigate(router.build(String(data.value)))}>
                {performanceDashboardTabs.map((tab) => (
                    <Tab key={tab.id} value={tab.id}>
                        {tab.title(performanceDashboardRouter.match(tab.path)!)}
                    </Tab>
                ))}
            </TabList>
            <main className={classes.content}>
                {/* Placeholder until the views are built. */}
                <Title3 as="h1" className={classes.title}>
                    {match.route.title(match)}
                </Title3>
            </main>
        </div>
    );
};

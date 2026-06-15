/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Tab, TabList, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { locConstants } from "../../common/locConstants";
import { useCloudDeployHubContext } from "./cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "./cloudDeployHubSelector";
import { RunListView } from "./views/runListView";
import { EnvironmentsListView } from "./views/environmentsListView";
import { EnvironmentView } from "./views/environmentView";
import { RunView } from "./views/runView";
import { CompareView } from "./views/compareView";

const useStyles = makeStyles({
    root: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "10px 18px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    title: {
        fontSize: "14px",
        fontWeight: 600,
    },
    content: {
        flex: "1 1 auto",
        overflowY: "auto",
        padding: "16px 18px",
    },
    error: {
        margin: "0 18px 8px 18px",
        padding: "8px 12px",
        borderRadius: "4px",
        backgroundColor: tokens.colorPaletteRedBackground2,
        color: tokens.colorPaletteRedForeground1,
        fontSize: "12px",
    },
});

export const CloudDeployHubPage: React.FC = () => {
    const classes = useStyles();
    const { refresh, navigate } = useCloudDeployHubContext();
    const currentPage = useCloudDeployHubSelector((s) => s.currentPage);
    const errorMessage = useCloudDeployHubSelector((s) => s.errorMessage);
    const strings = locConstants.cloudDeployHub;

    // The top tab switcher peers the two landing pages. Detail pages
    // (environment / run / compare) carry their own back arrow instead.
    const isLandingPage = currentPage === "environmentList" || currentPage === "runList";

    return (
        <div className={classes.root}>
            <div className={classes.header}>
                <Text className={classes.title}>{strings.title}</Text>
                {isLandingPage ? (
                    <TabList
                        selectedValue={currentPage}
                        onTabSelect={(_e, data) =>
                            navigate(data.value as "environmentList" | "runList")
                        }
                        size="small">
                        <Tab value="environmentList">{strings.tabEnvironments}</Tab>
                        <Tab value="runList">{strings.tabRuns}</Tab>
                    </TabList>
                ) : null}
                <Button size="small" onClick={refresh}>
                    {strings.refresh}
                </Button>
            </div>
            {errorMessage ? <div className={classes.error}>{errorMessage}</div> : null}
            <div className={classes.content}>
                {currentPage === "environmentList" && <EnvironmentsListView />}
                {currentPage === "runList" && <RunListView />}
                {currentPage === "environment" && <EnvironmentView />}
                {currentPage === "run" && <RunView />}
                {currentPage === "compare" && <CompareView />}
                {currentPage === "pipeline" && <RunListView />}
            </div>
        </div>
    );
};

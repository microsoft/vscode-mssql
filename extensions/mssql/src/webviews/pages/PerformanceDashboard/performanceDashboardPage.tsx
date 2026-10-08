/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands, Title3, tokens } from "@fluentui/react-components";
import { locConstants as loc } from "../../common/locConstants";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

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
        display: "flex",
        flexDirection: "column",
        ...shorthands.padding("16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    title: {
        color: "var(--vscode-foreground)",
        ...shorthands.margin(0),
    },
    connection: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
    },
});

export const PerformanceDashboardPage = () => {
    const classes = useStyles();
    const serverName = usePerformanceDashboardSelector((state) => state.serverName);
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);

    return (
        <div className={classes.root}>
            <div className={classes.header}>
                <Title3 className={classes.title}>{loc.performanceDashboard.title}</Title3>
                <span className={classes.connection}>
                    {databaseName
                        ? loc.performanceDashboard.serverAndDatabase(serverName, databaseName)
                        : serverName}
                </span>
            </div>
        </div>
    );
};

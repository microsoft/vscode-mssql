/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, tokens } from "@fluentui/react-components";
import { Dismiss16Regular, Open16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import {
    OpenInFabricDatabaseHubRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { FabricIcon20 } from "../../common/icons/fluentIcons";
import { locConstants as loc } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const useStyles = makeStyles({
    root: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        flexShrink: 0,
        columnGap: "32px",
        rowGap: "12px",
        padding: "16px 48px 16px 20px",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusLarge,
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    text: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
        flexGrow: 1,
        flexBasis: "360px",
        minWidth: 0,
    },
    eyebrow: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
    },
    icon: {
        flexShrink: 0,
        color: "var(--vscode-textLink-foreground)",
    },
    title: {
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
    },
    description: {
        color: "var(--vscode-descriptionForeground)",
    },
    open: {
        flexShrink: 0,
    },
    dismiss: {
        position: "absolute",
        top: "8px",
        right: "8px",
        minWidth: 0,
    },
});

/**
 * Offers to continue in the Fabric Database Hub, for databases the Hub tracks. Dismissing it hides
 * it until the dashboard opens again.
 */
export const PerformanceDashboardDatabaseHubBanner = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const available = usePerformanceDashboardSelector((state) => state.fabricDatabaseHubAvailable);
    const [dismissed, setDismissed] = useState(false);

    if (!available || dismissed) {
        return null;
    }

    return (
        <section className={classes.root} aria-label={text.databaseHubEyebrow}>
            <div className={classes.text}>
                <span className={classes.eyebrow}>
                    <FabricIcon20 className={classes.icon} aria-hidden />
                    {text.databaseHubEyebrow}
                </span>
                <Text as="h2" className={classes.title}>
                    {text.databaseHubTitle}
                </Text>
                <Text className={classes.description}>{text.databaseHubDescription}</Text>
            </div>
            <Button
                className={classes.open}
                appearance="primary"
                icon={<Open16Regular />}
                onClick={() => void extensionRpc.sendRequest(OpenInFabricDatabaseHubRequest.type)}>
                {text.openInDatabaseHub}
            </Button>
            <Button
                className={classes.dismiss}
                appearance="subtle"
                size="small"
                icon={<Dismiss16Regular />}
                aria-label={text.dismissDatabaseHub}
                title={text.dismissDatabaseHub}
                onClick={() => setDismissed(true)}
            />
        </section>
    );
};

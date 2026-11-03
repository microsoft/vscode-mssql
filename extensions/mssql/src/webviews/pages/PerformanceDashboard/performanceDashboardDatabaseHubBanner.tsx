/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Open16Regular } from "@fluentui/react-icons";
import {
    DismissDatabaseHubBannerRequest,
    OpenInDatabaseHubRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const fabricLogo = (): string => require("../../media/fabric-color.svg");

const useStyles = makeStyles({
    banner: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        ...shorthands.gap("12px", "24px"),
        ...shorthands.padding("16px", "20px"),
        ...shorthands.border(
            "1px",
            "solid",
            "var(--vscode-widget-border, var(--vscode-panel-border))",
        ),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    body: {
        display: "flex",
        alignItems: "flex-start",
        ...shorthands.gap("16px"),
        flexGrow: 1,
        flexBasis: "320px",
        minWidth: 0,
    },
    logo: {
        width: "40px",
        height: "40px",
        flexShrink: 0,
    },
    text: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
        minWidth: 0,
    },
    eyebrow: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
    },
    title: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
    },
    description: {
        color: tokens.colorNeutralForeground2,
        lineHeight: tokens.lineHeightBase300,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        ...shorthands.gap("8px"),
    },
});

/**
 * Offers to continue in the Fabric Database Hub, which shows the database's performance,
 * security, and optimization findings. Not now hides it for the connection.
 */
export const PerformanceDashboardDatabaseHubBanner = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const visible = usePerformanceDashboardSelector((state) => !!state.showDatabaseHubBanner);
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    if (!visible) {
        return null;
    }

    return (
        <section className={classes.banner} aria-label={text.databaseHubEyebrow}>
            <div className={classes.body}>
                <img className={classes.logo} src={fabricLogo()} alt="" aria-hidden />
                <div className={classes.text}>
                    <span className={classes.eyebrow}>{text.databaseHubEyebrow}</span>
                    <span className={classes.title}>{text.databaseHubTitle}</span>
                    <span className={classes.description}>{text.databaseHubDescription}</span>
                </div>
            </div>
            <div className={classes.actions}>
                <Button
                    appearance="secondary"
                    onClick={() =>
                        void extensionRpc.sendRequest(DismissDatabaseHubBannerRequest.type)
                    }>
                    {text.databaseHubNotNow}
                </Button>
                <Button
                    appearance="primary"
                    icon={<Open16Regular />}
                    onClick={() => void extensionRpc.sendRequest(OpenInDatabaseHubRequest.type)}>
                    {text.openInDatabaseHub}
                </Button>
            </div>
        </section>
    );
};

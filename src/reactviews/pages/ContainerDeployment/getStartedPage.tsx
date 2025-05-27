/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { PrereqCheckPage } from "./prereqCheckPage";
import { themeType } from "../../common/utils";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        width: "500px",
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
        marginBottom: "20px",
    },
    stepsHeader: {
        fontSize: "24px",
        textAlign: "left",
        flexWrap: "wrap",
        lineHeight: "1.5",
        marginBottom: "5px",
        fontWeight: 500,
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        height: "fit-content",
        padding: "10px",
    },
    textDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "left",
        gap: "10px",
        width: "500px",
    },
    titleDiv: {
        fontWeight: "bold",
    },
    icon: {
        width: "96px",
        height: "96px",
    },
});

export const GetStartedPage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const containerDeploymentState = state?.state;
    const theme = state!.themeKind;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !containerDeploymentState) {
        return undefined;
    }

    return showNext ? (
        <PrereqCheckPage />
    ) : (
        <div>
            <ContainerDeploymentHeader
                headerText={locConstants.containerDeployment.sqlServerContainerHeader}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.stepsHeader}>
                        {locConstants.containerDeployment.getStartedPageHeader}
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={oneClick(theme)}
                            alt={locConstants.containerDeployment.oneClickServerCreation}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.oneClickServerCreation}
                            </div>
                            <div>
                                {locConstants.containerDeployment.oneClickServerCreationDescription}
                            </div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={easyManagement(theme)}
                            alt={locConstants.containerDeployment.easyManagement}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.easyManagement}
                            </div>
                            <div>{locConstants.containerDeployment.easyManagementDescription}</div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={rightFit(theme)}
                            alt={locConstants.containerDeployment.pickTheRightFit}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.pickTheRightFit}
                            </div>
                            <div>{locConstants.containerDeployment.pickTheRightFitDescription}</div>
                            <a>{locConstants.containerDeployment.sqlServerOnDockerBestPractices}</a>
                            <a style={{ marginTop: "0px" }}>
                                {
                                    locConstants.containerDeployment
                                        .sqlServerEditionsAndFeatureComparison
                                }
                            </a>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={seamlessConnections(theme)}
                            alt={locConstants.containerDeployment.seamlessConnections}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.seamlessConnections}
                            </div>
                            <div>
                                {locConstants.containerDeployment.seamlessConnectionsDescription}
                            </div>
                        </div>
                    </div>
                    <Button
                        className={classes.button}
                        onClick={() => {
                            setShowNext(true);
                        }}
                        appearance={"primary"}>
                        {locConstants.containerDeployment.getStarted}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export const oneClick = (colorTheme: ColorThemeKind) => {
    return require(`./icons/OneClick_${themeType(colorTheme)}.svg`);
};

export const easyManagement = (colorTheme: ColorThemeKind) => {
    return require(`./icons/EasyManagement_${themeType(colorTheme)}.svg`);
};

export const rightFit = (colorTheme: ColorThemeKind) => {
    return require(`./icons/RightFit_${themeType(colorTheme)}.svg`);
};

export const seamlessConnections = (colorTheme: ColorThemeKind) => {
    return require(`./icons/SeamlessConnections_${themeType(colorTheme)}.svg`);
};

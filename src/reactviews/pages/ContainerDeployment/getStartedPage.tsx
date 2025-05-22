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
                headerText={"Local SQL Server database container connection"}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.stepsHeader}>
                        Seamless SQL Server on Docker, Right in VS Code!
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={oneClick(theme)}
                            alt="One Click Server Creation"
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                One Click Server Container Creation
                            </div>
                            <div>
                                Spin up a SQL server container in seconds—no manual setup needed.
                            </div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={easyManagement(theme)}
                            alt="Easy Management"
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>Easy Management</div>
                            <div>Start, stop, or remove your SQL server container anytime.</div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={rightFit(theme)}
                            alt="Pick the Right Fit"
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>Pick the Right Fit</div>
                            <div>
                                Not sure which SQL Server version to choose? We’ll guide you through
                                the options with best-practice recommendations.
                            </div>
                            <a>SQL Server on Docker Best Practices</a>
                            <a style={{ marginTop: "0px" }}>
                                SQL Server editions and Feature comparison
                            </a>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={seamlessConnections(theme)}
                            alt="Seamless Connections"
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>Seamless Connections</div>
                            <div>
                                Deploy, manage, and interact with SQL Server container — right from
                                VS Code, no context switching.
                            </div>
                        </div>
                    </div>
                    <Button
                        className={classes.button}
                        onClick={() => {
                            setShowNext(true);
                        }}
                        appearance={"primary"}>
                        Get Started
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

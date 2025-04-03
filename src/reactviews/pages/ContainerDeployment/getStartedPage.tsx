/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { PrereqCheckPage } from "./prereqCheckPage";
import { themeType } from "../../common/utils";
import { ColorThemeKind } from "../../common/vscodeWebviewProvider";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
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
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        width: "250px",
    },
    textDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "left",
        gap: "10px",
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
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsHeader}>
                    Seamless SQL Server on Docker, Right in VS Code!
                </div>
                <div className={classes.itemDiv}>
                    <img src={oneClick(theme)} alt="One Click Server Creation" />
                    <div className={classes.textDiv}>
                        <div>One Click Server Container Creation</div>
                        <div>bibbly bloop</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <img src={easyManagement(theme)} alt="Easy Management" />
                    <div className={classes.textDiv}>
                        <div>Easy Management</div>
                        <div>bibbly bloop</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <img src={rightFit(theme)} alt="Pick the Right Fit" />
                    <div className={classes.textDiv}>
                        <div>Pick the Right Fit</div>
                        <div>bibbly bloop</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <img src={seamlessConnections(theme)} alt="Seamless Connections" />
                    <div className={classes.textDiv}>
                        <div>Seamless Connections</div>
                        <div>bibbly bloop</div>
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

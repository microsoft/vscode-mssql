/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { PrereqCheckPage } from "./prereqCheckPage";
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
        width: "fit-content",
        textWrap: "nowrap",
        marginTop: "20px",
        marginBottom: "20px",
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
        width: "425px",
    },
    titleDiv: {
        fontWeight: "bold",
    },
    icon: {
        marginTop: "-10px",
        width: "75px",
        height: "75px",
        marginRight: "10px",
    },
    link: {
        textDecoration: "none",
    },
});

export const GetStartedPage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const containerDeploymentState = state?.state;

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
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={instantSetup()}
                            alt={locConstants.containerDeployment.instantContainerSetup}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.instantContainerSetup}
                            </div>
                            <div>
                                {locConstants.containerDeployment.instantContainerDescription}
                            </div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={chooseVersion()}
                            alt={locConstants.containerDeployment.chooseTheRightVersion}
                            style={{
                                width: "60px",
                                height: "60px",
                                marginLeft: "9px",
                                marginRight: "18px",
                            }}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.containerDeployment.chooseTheRightVersion}
                            </div>
                            <div>
                                {locConstants.containerDeployment.chooseTheRightVersionDescription}
                            </div>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/sql-server/what-s-new-in-sql-server-2025"
                                }
                                target="_blank"
                                className={classes.link}
                                rel="noopener noreferrer">
                                {locConstants.containerDeployment.learnMoreAboutSqlServer2025}
                            </a>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025?"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.link}
                                style={{ marginTop: "0px" }}>
                                {locConstants.containerDeployment.sqlServerEditionsComparison}
                            </a>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-configure"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.link}
                                style={{ marginTop: "0px" }}>
                                {locConstants.containerDeployment.configureAndCustomizeSqlServer}
                            </a>
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

export const instantSetup = () => {
    return require(`../../media/instantSetup.svg`);
};

export const chooseVersion = () => {
    return require(`../../media/chooseVersion.svg`);
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { LocalContainersContext } from "./localContainersStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { LocalContainersPrereqPage } from "./localContainersPrereqPage";
import { LocalContainersHeader } from "./localContainersHeader";
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

export const LocalContainersInfoPage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(LocalContainersContext);
    const [showNext, setShowNext] = useState(false);
    const localContainersState = state?.state;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !localContainersState) {
        return undefined;
    }

    return showNext ? (
        <LocalContainersPrereqPage />
    ) : (
        <div>
            <LocalContainersHeader
                headerText={locConstants.localContainers.sqlServerContainerHeader}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={instantSetup()}
                            alt={locConstants.localContainers.instantContainerSetup}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.localContainers.instantContainerSetup}
                            </div>
                            <div>{locConstants.localContainers.instantContainerDescription}</div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={chooseVersion()}
                            alt={locConstants.localContainers.chooseTheRightVersion}
                            style={{
                                width: "60px",
                                height: "60px",
                                marginLeft: "9px",
                                marginRight: "18px",
                            }}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.localContainers.chooseTheRightVersion}
                            </div>
                            <div>
                                {locConstants.localContainers.chooseTheRightVersionDescription}
                            </div>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/sql-server/what-s-new-in-sql-server-2025"
                                }
                                target="_blank"
                                className={classes.link}
                                rel="noopener noreferrer">
                                {locConstants.localContainers.learnMoreAboutSqlServer2025}
                            </a>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025?"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.link}
                                style={{ marginTop: "0px" }}>
                                {locConstants.localContainers.sqlServerEditionsComparison}
                            </a>
                            <a
                                href={
                                    "https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-configure"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.link}
                                style={{ marginTop: "0px" }}>
                                {locConstants.localContainers.configureAndCustomizeSqlServer}
                            </a>
                        </div>
                    </div>
                    <Button
                        className={classes.button}
                        onClick={() => {
                            setShowNext(true);
                        }}
                        appearance={"primary"}>
                        {locConstants.localContainers.getStarted}
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

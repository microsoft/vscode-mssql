/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { InstantSetupIcon } from "../../../common/icons/instantSetup";
import { ChooseVersionIcon } from "../../../common/icons/chooseVersion";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
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
        width: "32px",
        height: "32px",
        marginRight: "10px",
    },
    link: {
        textDecoration: "none",
    },
});

export const LocalContainersInfoPage: React.FC = () => {
    const classes = useStyles();

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <InstantSetupIcon
                        className={classes.icon}
                        aria-label={locConstants.localContainers.instantContainerSetup}
                    />
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.localContainers.instantContainerSetup}
                        </div>
                        <div>{locConstants.localContainers.instantContainerDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <ChooseVersionIcon
                        className={classes.icon}
                        aria-label={locConstants.localContainers.chooseTheRightVersion}
                    />
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.localContainers.chooseTheRightVersion}
                        </div>
                        <div>{locConstants.localContainers.chooseTheRightVersionDescription}</div>
                        <a
                            href="https://learn.microsoft.com/en-us/sql/sql-server/what-s-new-in-sql-server-2025"
                            target="_blank"
                            className={classes.link}
                            rel="noopener noreferrer">
                            {locConstants.localContainers.learnMoreAboutSqlServer2025}
                        </a>
                        <a
                            href="https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025?"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={classes.link}
                            style={{ marginTop: "0px" }}>
                            {locConstants.localContainers.sqlServerEditionsComparison}
                        </a>
                        <a
                            href="https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-configure"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={classes.link}
                            style={{ marginTop: "0px" }}>
                            {locConstants.localContainers.configureAndCustomizeSqlServer}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles } from "@fluentui/react-components";
import { DeploymentContext } from "../Deployment/deploymentStateProvider";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "row",
        gap: "20px",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingBottom: "50px",
        minWidth: "750px",
        minHeight: "fit-content",
        top: 0,
        left: 0,
        paddingTop: "50px",
        width: "100%",
    },
    titleDiv: {
        fontWeight: 500,
        fontSize: "24px",
        display: "flex",
        alignItems: "center",
    },
    icon: {
        width: "58px",
        height: "58px",
    },
});

interface HeaderProps {
    headerText: string;
    paddingLeft?: string;
}

export const LocalContainersHeader: React.FC<HeaderProps> = ({ headerText, paddingLeft }) => {
    const classes = useStyles();
    const state = useContext(DeploymentContext);
    const localContainersState = state?.state.deploymentTypeState;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !localContainersState) {
        return undefined;
    }

    return (
        <div className={classes.outerDiv} style={{ paddingLeft: paddingLeft ?? "70px" }}>
            <img className={classes.icon} src={dockerIcon()} />
            <div className={classes.titleDiv}>{headerText}</div>
        </div>
    );
};

export const dockerIcon = () => {
    return require(`../../media/docker.svg`);
};

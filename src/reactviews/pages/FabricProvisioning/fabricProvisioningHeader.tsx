/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles } from "@fluentui/react-components";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";

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
    paddingLeft?: string;
}

export const FabricProvisioningHeader: React.FC<HeaderProps> = ({ paddingLeft }) => {
    const state = useContext(FabricProvisioningContext);
    const classes = useStyles();
    const fabricProvisioningState = state?.state;

    if (!state || !fabricProvisioningState) return undefined;

    return (
        <div className={classes.outerDiv} style={{ paddingLeft: paddingLeft ?? "70px" }}>
            <img className={classes.icon} src={sqlInFabricIcon()} />
            <div className={classes.titleDiv}>SQL database in Fabric</div>
        </div>
    );
};

export const sqlInFabricIcon = () => {
    return require(`../../media/sqlDbInFabric.svg`);
};

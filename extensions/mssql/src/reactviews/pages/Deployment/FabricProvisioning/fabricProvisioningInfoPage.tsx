/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { BuiltOnAzureSqlIcon } from "../../../common/icons/builtOnAzureSql";
import { AnalyticsReadyIcon } from "../../../common/icons/analyticsReady";
import { InstantSetupIcon } from "../../../common/icons/instantSetup";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
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
        padding: "25px",
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
});

export const FabricProvisioningInfoPage: React.FC = () => {
    const classes = useStyles();

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <BuiltOnAzureSqlIcon
                        className={classes.icon}
                        aria-label={locConstants.fabricProvisioning.builtOnAzureSQL}
                    />
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.fabricProvisioning.builtOnAzureSQL}
                        </div>
                        <div>{locConstants.fabricProvisioning.builtOnAzureSQLDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <AnalyticsReadyIcon
                        className={classes.icon}
                        aria-label={locConstants.fabricProvisioning.analyticsReady}
                    />
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.fabricProvisioning.analyticsReady}
                        </div>
                        <div>{locConstants.fabricProvisioning.analyticsReadyDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <InstantSetupIcon
                        className={classes.icon}
                        aria-label={locConstants.fabricProvisioning.integratedAndSecure}
                    />
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.fabricProvisioning.integratedAndSecure}
                        </div>
                        <div>{locConstants.fabricProvisioning.integratedAndSecureDescription}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

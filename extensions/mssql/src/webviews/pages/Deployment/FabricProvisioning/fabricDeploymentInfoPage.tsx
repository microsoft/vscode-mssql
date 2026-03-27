/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { AnalyticsReadyIcon } from "../../../common/icons/analyticsReady";
import { BuiltOnAzureSqlIcon } from "../../../common/icons/builtOnAzureSql";
import { InstantSetupIcon } from "../../../common/icons/instantSetup";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: "fit-content",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "0",
        alignItems: "stretch",
        justifyContent: "flex-start",
        width: "100%",
        minWidth: 0,
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        height: "fit-content",
        padding: "16px 25px",
        width: "100%",
        boxSizing: "border-box",
    },
    textDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        minWidth: 0,
    },
    titleDiv: {
        fontWeight: "bold",
    },
    iconWrap: {
        width: "32px",
        height: "32px",
        marginTop: "2px",
        marginRight: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    icon: {
        width: "32px",
        height: "32px",
    },
});

export const FabricDeploymentInfoPage: React.FC = () => {
    const classes = useStyles();
    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <BuiltOnAzureSqlIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.fabricProvisioning.builtOnAzureSQL}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.fabricProvisioning.builtOnAzureSQL}
                        </div>
                        <div>{locConstants.fabricProvisioning.builtOnAzureSQLDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <AnalyticsReadyIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.fabricProvisioning.analyticsReady}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.fabricProvisioning.analyticsReady}
                        </div>
                        <div>{locConstants.fabricProvisioning.analyticsReadyDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <InstantSetupIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.fabricProvisioning.integratedAndSecure}
                        />
                    </div>
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

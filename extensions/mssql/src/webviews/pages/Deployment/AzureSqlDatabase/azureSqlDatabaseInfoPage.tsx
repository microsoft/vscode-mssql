/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { AzureSqlDatabaseLinks } from "../../../../sharedInterfaces/azureSqlDatabase";
import { DocsLinkCard } from "./docsLinkCard";
import { BuiltOnAzureSqlIcon } from "../../../common/icons/builtOnAzureSql";
import { AnalyticsReadyIcon } from "../../../common/icons/analyticsReady";
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
    descriptionDiv: {
        color: "var(--colorNeutralForeground4)",
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

export const AzureSqlDatabaseInfoPage: React.FC = () => {
    const classes = useStyles();

    const links = [
        {
            href: AzureSqlDatabaseLinks.freeOffer,
            label: locConstants.azureSqlDatabase.learnMoreAboutFreeTier,
        },
        {
            href: AzureSqlDatabaseLinks.serviceTiers,
            label: locConstants.azureSqlDatabase.compareTiers,
        },
        {
            href: AzureSqlDatabaseLinks.createQuickstart,
            label: locConstants.azureSqlDatabase.configureAndCustomize,
        },
    ];

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <BuiltOnAzureSqlIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.azureSqlDatabase.oltpAzureSql}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.oltpAzureSql}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.oltpAzureSqlDescription}
                        </div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <AnalyticsReadyIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.azureSqlDatabase.freeComputeAndScaling}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.freeComputeAndScaling}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.freeComputeAndScalingDescription}
                        </div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <InstantSetupIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.azureSqlDatabase.integratedAndSecure}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.integratedAndSecure}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.integratedAndSecureDescription}
                        </div>
                    </div>
                </div>
                <DocsLinkCard title={locConstants.azureSqlDatabase.learnMore} links={links} />
            </div>
        </div>
    );
};

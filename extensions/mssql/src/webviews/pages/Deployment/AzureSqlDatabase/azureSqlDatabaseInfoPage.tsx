/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { Database24Regular, DataTrending24Regular, Shield24Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { AzureSqlDatabaseLinks } from "../../../../sharedInterfaces/azureSqlDatabase";
import { DocsLinkCard } from "./docsLinkCard";

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
                        <Database24Regular
                            style={{
                                color: "var(--colorBrandForeground1)",
                            }}
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
                        <DataTrending24Regular
                            style={{
                                color: "var(--colorBrandForeground1)",
                            }}
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
                        <Shield24Regular
                            style={{
                                color: "var(--colorBrandForeground1)",
                            }}
                        />
                    </div>
                    <div className={classes.textDiv} style={{ marginBottom: "8px" }}>
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

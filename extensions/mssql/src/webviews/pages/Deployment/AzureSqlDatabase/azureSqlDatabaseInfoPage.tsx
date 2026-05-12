/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text } from "@fluentui/react-components";
import { ArrowRight12Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
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
    docsCard: {
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--colorNeutralBackground1Hover)",
        padding: "16px",
        width: "100%",
        boxSizing: "border-box",
    },
    docsTitle: {
        display: "block",
        marginBottom: "8px",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "16px",
    },
    docsActions: {
        display: "flex",
        flexDirection: "column",
    },
    docsAction: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minHeight: "24px",
        padding: "2px 0",
        fontSize: "12px",
        lineHeight: "16px",
        color: "var(--vscode-textLink-foreground)",
        textDecorationLine: "none",
    },
});

export const AzureSqlDatabaseInfoPage: React.FC = () => {
    const classes = useStyles();

    const links = [
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer",
            label: locConstants.azureSqlDatabase.learnMoreAboutFreeTier,
        },
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-sql-database-vcore",
            label: locConstants.azureSqlDatabase.compareTiers,
        },
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/single-database-create-quickstart",
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
                        <div>{locConstants.azureSqlDatabase.otlpAzureSqlDescription}</div>
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
                        <div>{locConstants.azureSqlDatabase.freeComputeAndScalingDescription}</div>
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
                        <div>{locConstants.azureSqlDatabase.integratedAndSecureDescription}</div>
                    </div>
                </div>
                <div className={classes.docsCard}>
                    <Text className={classes.docsTitle}>
                        {locConstants.azureSqlDatabase.learnMore}
                    </Text>
                    <div className={classes.docsActions}>
                        {links.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.docsAction}>
                                <span>{link.label}</span>
                                <ArrowRight12Regular />
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

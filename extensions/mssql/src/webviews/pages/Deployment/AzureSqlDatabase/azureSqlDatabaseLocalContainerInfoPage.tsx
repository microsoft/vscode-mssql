/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import {
    ArrowSync24Regular,
    CloudArrowUp24Regular,
    WindowDevTools24Regular,
} from "@fluentui/react-icons";
import { AzureSqlDatabaseLinks } from "../../../../sharedInterfaces/azureSqlDatabase";
import { locConstants } from "../../../common/locConstants";
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
        color: "var(--colorBrandForeground1)",
    },
});

export const AzureSqlDatabaseLocalContainerInfoPage: React.FC = () => {
    const classes = useStyles();
    const links = [
        {
            href: AzureSqlDatabaseLinks.developerContainerOverview,
            label: locConstants.azureSqlDatabase.learnMoreAboutDeveloperContainer,
        },
        {
            href: AzureSqlDatabaseLinks.developerContainerDevContainers,
            label: locConstants.azureSqlDatabase.useDevContainersWithAzureSqlDatabase,
        },
        {
            href: AzureSqlDatabaseLinks.developerContainerConfiguration,
            label: locConstants.azureSqlDatabase.configureDeveloperContainer,
        },
    ];

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <CloudArrowUp24Regular aria-hidden="true" />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.paasAlignedLocalDevelopment}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.paasAlignedLocalDevelopmentDescription}
                        </div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <ArrowSync24Regular aria-hidden="true" />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.crossPlatformArmAndX64}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.crossPlatformArmAndX64Description}
                        </div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <WindowDevTools24Regular aria-hidden="true" />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.azureSqlDatabase.usePreferredContainerEngine}
                        </div>
                        <div className={classes.descriptionDiv}>
                            {locConstants.azureSqlDatabase.usePreferredContainerEngineDescription}
                        </div>
                    </div>
                </div>
                <DocsLinkCard title={locConstants.common.learnMore} links={links} />
            </div>
        </div>
    );
};

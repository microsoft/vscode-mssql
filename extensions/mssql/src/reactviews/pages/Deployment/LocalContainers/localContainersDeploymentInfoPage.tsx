/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text } from "@fluentui/react-components";
import { ArrowRight12Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { ChooseVersionIcon } from "../../../common/icons/chooseVersion";
import { DockerIcon } from "../../../common/icons/docker";
import { InstantSetupIcon } from "../../../common/icons/instantSetup";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "0",
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
        width: "425px",
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
        backgroundColor: "var(--vscode-sideBar-background)",
        padding: "16px",
        width: "100%",
        boxSizing: "border-box",
    },
    docsTitle: {
        marginBottom: "10px",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "16px",
        letterSpacing: "0.01em",
    },
    docsActions: {
        display: "flex",
        flexDirection: "column",
    },
    docsAction: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minHeight: "34px",
        padding: "6px 0",
        fontSize: "12px",
        lineHeight: "16px",
        color: "var(--vscode-textLink-foreground)",
        textDecorationLine: "none",
        ":not(:last-child)": {
            borderBottom:
                "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 70%, transparent)",
        },
    },
});

export const LocalContainersDeploymentInfoPage: React.FC = () => {
    const classes = useStyles();

    const links = [
        {
            href: "https://learn.microsoft.com/en-us/sql/sql-server/what-s-new-in-sql-server-2025",
            label: locConstants.localContainers.learnMoreAboutSqlServer2025,
        },
        {
            href: "https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025?",
            label: locConstants.localContainers.sqlServerEditionsComparison,
        },
        {
            href: "https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-configure",
            label: locConstants.localContainers.configureAndCustomizeSqlServer,
        },
    ];

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <InstantSetupIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.localContainers.instantContainerSetup}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.localContainers.instantContainerSetup}
                        </div>
                        <div>{locConstants.localContainers.instantContainerDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <DockerIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.localContainers.simpleManagement}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.localContainers.simpleManagement}
                        </div>
                        <div>{locConstants.localContainers.simpleManagementDescription}</div>
                    </div>
                </div>
                <div className={classes.itemDiv}>
                    <div className={classes.iconWrap}>
                        <ChooseVersionIcon
                            className={classes.icon}
                            role="img"
                            aria-label={locConstants.localContainers.chooseTheRightVersion}
                        />
                    </div>
                    <div className={classes.textDiv}>
                        <div className={classes.titleDiv}>
                            {locConstants.localContainers.chooseTheRightVersion}
                        </div>
                        <div>{locConstants.localContainers.chooseTheRightVersionDescription}</div>
                    </div>
                </div>
                <div className={classes.docsCard}>
                    <Text className={classes.docsTitle}>Learn More</Text>
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

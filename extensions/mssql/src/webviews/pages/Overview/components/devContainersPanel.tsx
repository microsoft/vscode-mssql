/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { Box20Regular, Open16Regular } from "@fluentui/react-icons";
import { useState } from "react";

import {
    DevContainerTemplate,
    getDevContainerTemplates,
    getTemplateSourceUrl,
    overviewLinks,
} from "../overviewContent";
import { DevContainerSetupDialog } from "./devContainerSetupDialog";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    description: {
        color: tokens.colorNeutralForeground3,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    card: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        padding: tokens.spacingVerticalM,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    cardButton: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        flexGrow: 1,
        minWidth: 0,
        textAlign: "left",
        backgroundColor: "transparent",
        border: "none",
        padding: 0,
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        cursor: "pointer",
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "2px",
        },
    },
    cardIcon: {
        display: "flex",
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    cardName: {
        fontWeight: tokens.fontWeightSemibold,
    },
    learnMore: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
    },
    // A template can only be scaffolded into an open folder, so the cards read as unavailable
    // rather than disappearing — the message bar above says how to enable them.
    disabledCard: {
        opacity: 0.5,
    },
});

export const DevContainersPanel = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink, openFolder, reopenInContainer } = useOverviewActions();
    const hasWorkspaceFolder = useOverviewSelector((state) => state.hasWorkspaceFolder);
    const hasDevContainerConfig = useOverviewSelector((state) => state.hasDevContainerConfig);
    const [activeTemplate, setActiveTemplate] = useState<DevContainerTemplate | undefined>(
        undefined,
    );

    return (
        <div className={classes.root}>
            <Text className={classes.description}>{loc.devContainersDescription}</Text>

            {!hasWorkspaceFolder && (
                <MessageBar intent="info">
                    <MessageBarBody>{loc.openFolderToCreateConfiguration}</MessageBarBody>
                    <MessageBarActions>
                        <Button size="small" onClick={openFolder}>
                            {loc.openFolder}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}

            {/* Already configured: reopening in the container is the only useful step left. */}
            {hasWorkspaceFolder && hasDevContainerConfig && (
                <MessageBar intent="success">
                    <MessageBarBody>{loc.devContainerConfigFound}</MessageBarBody>
                    <MessageBarActions>
                        <Button size="small" onClick={reopenInContainer}>
                            {loc.openVsCodeInContainer}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}

            {!hasDevContainerConfig && (
                <div className={classes.grid}>
                    {getDevContainerTemplates().map((template) => (
                        <div
                            key={template.id}
                            className={mergeClasses(
                                classes.card,
                                !hasWorkspaceFolder && classes.disabledCard,
                            )}>
                            <button
                                type="button"
                                className={classes.cardButton}
                                disabled={!hasWorkspaceFolder}
                                onClick={() => setActiveTemplate(template)}>
                                <span className={classes.cardIcon}>
                                    <Box20Regular />
                                </span>
                                <Text className={classes.cardName}>{template.name}</Text>
                            </button>
                            <Link
                                href={getTemplateSourceUrl(template)}
                                title={getTemplateSourceUrl(template)}
                                aria-label={loc.viewOnGitHub}
                                onClick={(event) => {
                                    event.preventDefault();
                                    openLink(getTemplateSourceUrl(template));
                                }}>
                                <Open16Regular />
                            </Link>
                        </div>
                    ))}
                </div>
            )}
            <Link
                href={overviewLinks.devContainersQuickstart}
                title={overviewLinks.devContainersQuickstart}
                className={classes.learnMore}
                onClick={(event) => {
                    event.preventDefault();
                    openLink(overviewLinks.devContainersQuickstart);
                }}>
                {loc.devContainersLearnMore}
                <Open16Regular />
            </Link>

            {activeTemplate && (
                <DevContainerSetupDialog
                    template={activeTemplate}
                    onDismiss={() => setActiveTemplate(undefined)}
                />
            )}
        </div>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
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
});

export const DevContainersPanel = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();
    const [activeTemplate, setActiveTemplate] = useState<DevContainerTemplate | undefined>(
        undefined,
    );

    return (
        <div className={classes.root}>
            <Text className={classes.description}>{loc.devContainersDescription}</Text>
            <div className={classes.grid}>
                {getDevContainerTemplates().map((template) => (
                    <div key={template.id} className={classes.card}>
                        <button
                            type="button"
                            className={classes.cardButton}
                            onClick={() => setActiveTemplate(template)}>
                            <span className={classes.cardIcon}>
                                <Box20Regular />
                            </span>
                            <Text className={classes.cardName}>{template.name}</Text>
                        </button>
                        <Tooltip content={loc.viewOnGitHub} relationship="label">
                            <Link
                                as="button"
                                aria-label={loc.viewOnGitHub}
                                onClick={() => openLink(getTemplateSourceUrl(template))}>
                                <Open16Regular />
                            </Link>
                        </Tooltip>
                    </div>
                ))}
            </div>
            <Link
                as="button"
                className={classes.learnMore}
                onClick={() => openLink(overviewLinks.devContainersQuickstart)}>
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

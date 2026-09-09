/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { ReactNode } from "react";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "flex-start",
        gap: tokens.spacingHorizontalM,
        width: "100%",
        textAlign: "left",
        padding: tokens.spacingVerticalM,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "1px",
        },
    },
    icon: {
        display: "flex",
        flexShrink: 0,
        marginTop: "2px",
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
    },
    description: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

interface ActionCardProps {
    icon: ReactNode;
    title: string;
    description?: string;
    onClick: () => void;
}

/**
 * Clickable card used by the Walkthroughs and Discover sections. Rendered as a button so it is
 * reachable by keyboard and announced as an action rather than as static text.
 */
export const ActionCard = ({ icon, title, description, onClick }: ActionCardProps) => {
    const classes = useStyles();
    return (
        <button type="button" className={classes.root} onClick={onClick}>
            <span className={classes.icon}>{icon}</span>
            <span className={classes.body}>
                <Text className={classes.title}>{title}</Text>
                {description && <Text className={classes.description}>{description}</Text>}
            </span>
        </button>
    );
};

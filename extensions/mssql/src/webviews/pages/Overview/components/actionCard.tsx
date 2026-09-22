/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ReactNode } from "react";
import { ChevronRight16Regular } from "@fluentui/react-icons";

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
    // Flush navigation row inside a panel that already draws the boundary.
    row: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        borderTopColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        backgroundColor: "transparent",
        alignItems: "center",
        ":hover": {
            // Not `colorNeutralBackground1Hover`: the webview's theme bridge remaps that to the
            // dropdown background, which in light themes is the same colour as the panel behind
            // this row. As a card the border carried the hover, but a row has none, so there was
            // nothing left to see. This is the colour VS Code hovers its own list rows with.
            backgroundColor: tokens.colorSubtleBackgroundHover,
            borderTopColor: "transparent",
            borderRightColor: "transparent",
            borderBottomColor: "transparent",
            borderLeftColor: "transparent",
        },
        ":active": {
            backgroundColor: tokens.colorSubtleBackgroundPressed,
        },
    },
    icon: {
        display: "flex",
        flexShrink: 0,
        marginTop: "2px",
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    rowIcon: {
        marginTop: 0,
        color: tokens.colorNeutralForeground2,
    },
    // Signals that the row goes somewhere, which a bordered card does not need to say.
    chevron: {
        display: "flex",
        flexShrink: 0,
        marginLeft: "auto",
        alignSelf: "center",
        color: tokens.colorNeutralForeground3,
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
    /**
     * `card` stands on its own in the page. `row` sits inside a panel that already draws the
     * boundary, so it drops its border and gains a chevron to read as navigation.
     */
    appearance?: "card" | "row";
    onClick: () => void;
}

/**
 * Clickable card used by the Walkthroughs and Discover sections. Rendered as a button so it is
 * reachable by keyboard and announced as an action rather than as static text.
 */
export const ActionCard = ({
    icon,
    title,
    description,
    appearance = "card",
    onClick,
}: ActionCardProps) => {
    const classes = useStyles();
    const isRow = appearance === "row";
    return (
        <button
            type="button"
            className={mergeClasses(classes.root, isRow && classes.row)}
            onClick={onClick}>
            <span className={mergeClasses(classes.icon, isRow && classes.rowIcon)}>{icon}</span>
            <span className={classes.body}>
                <Text className={classes.title}>{title}</Text>
                {description && <Text className={classes.description}>{description}</Text>}
            </span>
            {isRow && (
                <span className={classes.chevron} aria-hidden="true">
                    <ChevronRight16Regular />
                </span>
            )}
        </button>
    );
};

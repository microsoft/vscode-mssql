/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { makeStyles, Text } from "@fluentui/react-components";

const useStyles = makeStyles({
    empty: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "24px",
        textAlign: "center",
    },
    emptyIllustration: {
        position: "relative",
        width: "72px",
        height: "72px",
        display: "grid",
        placeItems: "center",
    },
    emptyOuterRing: {
        position: "absolute",
        inset: 0,
        borderRadius: "999px",
        border: "1px solid var(--vscode-editorWidget-border)",
        opacity: 0.5,
    },
    emptyInnerRing: {
        width: "46px",
        height: "46px",
        borderRadius: "999px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editorWidget-background)",
        display: "grid",
        placeItems: "center",
        boxShadow: "0 0 0 1px var(--vscode-editorWidget-border) inset",
    },
    emptyIcon: {
        fontSize: "22px",
        color: "var(--vscode-descriptionForeground)",
    },
    emptyTextBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        maxWidth: "220px",
        textAlign: "center",
    },
    emptyTitle: {
        color: "var(--vscode-foreground)",
        fontWeight: 600,
        fontSize: "13px",
        textAlign: "center",
    },
    emptySubtitle: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "12px",
        textAlign: "center",
    },
});

type SchemaDesignerChangesEmptyStateProps = {
    icon: React.ReactElement;
    title: string;
    subtitle?: string;
};

export const SchemaDesignerChangesEmptyState = ({
    icon,
    title,
    subtitle,
}: SchemaDesignerChangesEmptyStateProps): JSX.Element => {
    const classes = useStyles();

    return (
        <div className={classes.empty}>
            <div className={classes.emptyIllustration}>
                <div className={classes.emptyOuterRing} />
                <div className={classes.emptyInnerRing}>
                    {React.cloneElement(icon, { className: classes.emptyIcon })}
                </div>
            </div>
            <div className={classes.emptyTextBlock}>
                <Text className={classes.emptyTitle}>{title}</Text>
                {subtitle ? <Text className={classes.emptySubtitle}>{subtitle}</Text> : null}
            </div>
        </div>
    );
};

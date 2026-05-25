/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode } from "react";
import { makeStyles, Text } from "@fluentui/react-components";

const useStyles = makeStyles({
    empty: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "8px 16px",
        textAlign: "center",
        overflow: "hidden",
    },
    emptyIllustration: {
        display: "grid",
        placeItems: "center",
        fontSize: "24px",
        lineHeight: "24px",
        color: "var(--vscode-descriptionForeground)",
        flexShrink: 0,
    },
    emptyTextBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        maxWidth: "220px",
        textAlign: "center",
        minHeight: 0,
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
    icon: ReactNode;
    title: string;
    subtitle?: string;
};

export const SchemaDesignerChangesEmptyState = ({
    icon,
    title,
    subtitle,
}: SchemaDesignerChangesEmptyStateProps) => {
    const classes = useStyles();

    return (
        <div className={classes.empty}>
            <div className={classes.emptyIllustration}>{icon}</div>
            <div className={classes.emptyTextBlock}>
                <Text className={classes.emptyTitle}>{title}</Text>
                {subtitle ? <Text className={classes.emptySubtitle}>{subtitle}</Text> : undefined}
            </div>
        </div>
    );
};

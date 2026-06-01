/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text } from "@fluentui/react-components";
import { ArrowRight12Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
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
        fontSize: "13px",
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
        fontSize: "13px",
        lineHeight: "18px",
        color: "var(--vscode-textLink-foreground)",
        textDecorationLine: "none",
    },
});

interface DocsLinkCardProps {
    title: string;
    links: { href: string; label: string }[];
}

export const DocsLinkCard: React.FC<DocsLinkCardProps> = ({ title, links }) => {
    const classes = useStyles();

    return (
        <div className={classes.docsCard}>
            <Text className={classes.docsTitle}>{title}</Text>
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
    );
};

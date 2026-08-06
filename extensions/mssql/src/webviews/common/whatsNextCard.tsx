/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import { Button, Card, Link, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
    ArrowRight12Regular,
    ChevronDownRegular,
    ChevronRightRegular,
} from "@fluentui/react-icons";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    card: {
        height: "fit-content",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: "0",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        boxShadow: "none",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        width: "100%",
        boxSizing: "border-box",
    },
    chevronButton: {
        minWidth: "24px",
        maxWidth: "24px",
        width: "24px",
        height: "24px",
        padding: "0",
        flexShrink: 0,
    },
    chevron: {
        fontSize: "20px",
        width: "20px",
        height: "20px",
    },
    title: {
        flexShrink: 0,
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
    },
    collapsedDescription: {
        minWidth: 0,
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "13px",
        fontWeight: tokens.fontWeightRegular,
        color: tokens.colorNeutralForeground4,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "12px 12px 12px 44px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    link: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        alignSelf: "flex-start",
        minHeight: "24px",
        fontSize: "13px",
        textDecorationLine: "none",
    },
});

const whatsNextUrls = {
    tableDesigner: "https://aka.ms/vscode-mssql/table-designer",
    importFlatFile: "https://aka.ms/vscode-mssql/import-flat-file",
    schemaDesigner: "https://aka.ms/vscode-mssql/schema-designer",
    schemaCompare: "https://aka.ms/vscode-mssql/schema-compare",
    firstQuery: "https://aka.ms/vscode-mssql/first-query",
    githubCopilot: "https://aka.ms/vscode-mssql/github-copilot",
} as const;

export interface WhatsNextCardProps {
    className?: string;
}

export const WhatsNextCard: React.FC<WhatsNextCardProps> = ({ className }) => {
    const classes = useStyles();
    const loc = locConstants.whatsNext;
    const [isOpen, setIsOpen] = useState(false);
    const links = [
        { label: loc.designTables, href: whatsNextUrls.tableDesigner },
        { label: loc.importFlatFile, href: whatsNextUrls.importFlatFile },
        { label: loc.schemaDesigner, href: whatsNextUrls.schemaDesigner },
        { label: loc.schemaCompare, href: whatsNextUrls.schemaCompare },
        { label: loc.runFirstQuery, href: whatsNextUrls.firstQuery },
        { label: loc.githubCopilot, href: whatsNextUrls.githubCopilot },
    ];

    return (
        <Card className={mergeClasses(classes.card, className)}>
            <div className={classes.header}>
                <Button
                    type="button"
                    appearance="subtle"
                    className={classes.chevronButton}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? loc.collapseCard : loc.expandCard}
                    icon={
                        isOpen ? (
                            <ChevronDownRegular className={classes.chevron} />
                        ) : (
                            <ChevronRightRegular className={classes.chevron} />
                        )
                    }
                    onClick={() => setIsOpen((open) => !open)}
                />
                <span className={classes.title}>{loc.title}</span>
                {!isOpen && (
                    <span className={classes.collapsedDescription} title={loc.description}>
                        {loc.description}
                    </span>
                )}
            </div>
            {isOpen && (
                <div className={classes.body}>
                    {links.map((link) => (
                        <Link
                            key={link.href}
                            className={classes.link}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer">
                            <span>{link.label}</span>
                            <ArrowRight12Regular />
                        </Link>
                    ))}
                </div>
            )}
        </Card>
    );
};

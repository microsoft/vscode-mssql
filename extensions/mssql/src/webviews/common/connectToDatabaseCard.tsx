/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import {
    Button,
    Card,
    Link,
    makeStyles,
    mergeClasses,
    Text,
    ToggleButton,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowRight12Regular,
    BookOpen16Regular,
    ChevronDownRegular,
    ChevronRightRegular,
    Copy16Regular,
} from "@fluentui/react-icons";
import { locConstants } from "./locConstants";

/** Ordered list of supported migration tools and the command each one runs. */
const MIGRATION_TOOLS: { id: string; label: string; command: string; docsUrl: string }[] = [
    {
        id: "prisma",
        label: "Prisma",
        command: "npx prisma migrate deploy",
        docsUrl: "https://www.prisma.io/docs/orm/prisma-migrate",
    },
    {
        id: "sequelize",
        label: "Sequelize",
        command: "npx sequelize-cli db:migrate",
        docsUrl: "https://sequelize.org/docs/v6/other-topics/migrations/",
    },
    {
        id: "typeORM",
        label: "TypeORM",
        command: "npx typeorm migration:run -d ./data-source.ts",
        docsUrl: "https://typeorm.io/docs/advanced-topics/migrations/",
    },
    {
        id: "drizzle",
        label: "Drizzle",
        command: "npx drizzle-kit migrate",
        docsUrl: "https://orm.drizzle.team/docs/migrations",
    },
    {
        id: "sqlAlchemy",
        label: "SQLAlchemy",
        command: "alembic upgrade head",
        docsUrl: "https://alembic.sqlalchemy.org/latest/tutorial.html",
    },
    {
        id: "efCore",
        label: "EF Core",
        command: "dotnet ef database update",
        docsUrl: "https://learn.microsoft.com/ef/core/managing-schemas/migrations/",
    },
    {
        id: "flyway",
        label: "Flyway",
        command: "flyway migrate",
        docsUrl: "https://documentation.red-gate.com/flyway/reference/commands/migrate",
    },
    {
        id: "tSql",
        label: "T-SQL",
        command: "sqlcmd -i ./schema.sql",
        docsUrl:
            "https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility?view=sql-server-ver17&tabs=go%2Cwindows-support&pivots=cs1-bash",
    },
];

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
    headerSection: {
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
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        flexShrink: 0,
    },
    collapsedSubtitle: {
        minWidth: 0,
        flexGrow: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "13px",
        color: tokens.colorNeutralForeground4,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    subtitle: {
        fontSize: "13px",
        color: tokens.colorNeutralForeground4,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    sectionHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    label: {
        color: tokens.colorNeutralForeground3,
    },
    frameworkTag: {
        color: tokens.colorNeutralForeground3,
    },
    codeRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "8px 12px",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
        minWidth: 0,
    },
    codeText: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        flexGrow: 1,
    },
    copyButton: {
        flexShrink: 0,
    },
    toolRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
    },
    toolButton: {
        minWidth: "auto",
        fontSize: tokens.fontSizeBase300,
    },
    docsLink: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        alignSelf: "flex-start",
        fontSize: "13px",
    },
});

export interface ConnectToDatabaseCardProps {
    /** Connection string to display in the card. */
    connectionString: string;
    /** Optional detected project framework (e.g. "Node.js"); the tag is hidden when unset. */
    detectedFramework?: string;
    className?: string;
}

export const ConnectToDatabaseCard: React.FC<ConnectToDatabaseCardProps> = ({
    connectionString,
    detectedFramework,
    className,
}) => {
    const classes = useStyles();
    const loc = locConstants.connectToDatabase;
    const [selectedToolId, setSelectedToolId] = useState<string>(MIGRATION_TOOLS[0].id);
    const [connectionCopied, setConnectionCopied] = useState(false);
    const [commandCopied, setCommandCopied] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const selectedTool =
        MIGRATION_TOOLS.find((tool) => tool.id === selectedToolId) ?? MIGRATION_TOOLS[0];

    const copyToClipboard = async (value: string, setCopied: (copied: boolean) => void) => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className={mergeClasses(classes.card, className)}>
            <div className={classes.headerSection}>
                <Button
                    type="button"
                    className={classes.chevronButton}
                    appearance="subtle"
                    icon={
                        isOpen ? (
                            <ChevronDownRegular className={classes.chevron} />
                        ) : (
                            <ChevronRightRegular className={classes.chevron} />
                        )
                    }
                    aria-expanded={isOpen}
                    aria-label={isOpen ? loc.collapseCard : loc.expandCard}
                    onClick={() => setIsOpen((open) => !open)}
                />
                <span className={classes.title}>{loc.title}</span>
                {!isOpen && (
                    <span className={classes.collapsedSubtitle} title={loc.subtitle}>
                        {loc.subtitle}
                    </span>
                )}
            </div>

            {isOpen && (
                <div className={classes.body}>
                    <span className={classes.subtitle}>{loc.subtitle}</span>

                    <div className={classes.section}>
                        <Text size={200} weight="semibold" className={classes.label}>
                            {loc.connectionString}
                        </Text>
                        <div className={classes.codeRow}>
                            <span className={classes.codeText} title={connectionString}>
                                {connectionString}
                            </span>
                            <Button
                                className={classes.copyButton}
                                appearance="subtle"
                                size="small"
                                icon={<Copy16Regular />}
                                aria-label={loc.copyConnectionString}
                                onClick={() =>
                                    void copyToClipboard(connectionString, setConnectionCopied)
                                }>
                                {connectionCopied ? loc.copied : loc.copy}
                            </Button>
                        </div>
                    </div>

                    <div className={classes.section}>
                        <div className={classes.sectionHeader}>
                            <Text size={200} weight="semibold" className={classes.label}>
                                {loc.runYourMigrations}
                            </Text>
                            {detectedFramework && (
                                <Text size={200} className={classes.frameworkTag}>
                                    {detectedFramework}
                                </Text>
                            )}
                        </div>
                        <div
                            className={classes.toolRow}
                            role="radiogroup"
                            aria-label={loc.runYourMigrations}>
                            {MIGRATION_TOOLS.map((tool) => (
                                <ToggleButton
                                    key={tool.id}
                                    className={classes.toolButton}
                                    size="small"
                                    role="radio"
                                    aria-checked={tool.id === selectedToolId}
                                    appearance={tool.id === selectedToolId ? "primary" : "outline"}
                                    checked={tool.id === selectedToolId}
                                    onClick={() => setSelectedToolId(tool.id)}>
                                    {tool.label}
                                </ToggleButton>
                            ))}
                        </div>
                        <div className={classes.codeRow}>
                            <span className={classes.codeText} title={selectedTool.command}>
                                {selectedTool.command}
                            </span>
                            <Button
                                className={classes.copyButton}
                                appearance="subtle"
                                size="small"
                                icon={<Copy16Regular />}
                                aria-label={loc.copyMigrationCommand}
                                onClick={() =>
                                    void copyToClipboard(selectedTool.command, setCommandCopied)
                                }>
                                {commandCopied ? loc.copied : loc.copy}
                            </Button>
                        </div>
                        <Link
                            className={classes.docsLink}
                            href={selectedTool.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer">
                            <BookOpen16Regular />
                            {loc.toolDocs(selectedTool.label)}
                            <ArrowRight12Regular />
                        </Link>
                    </div>
                </div>
            )}
        </Card>
    );
};

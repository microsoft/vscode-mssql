/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Link,
    Text,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { ArrowRight12Regular } from "@fluentui/react-icons";
import React, { useCallback, useState } from "react";

import {
    ChangelogAction,
    ChangelogCommandRequest,
    ChangelogCommandRequestParams,
    ChangelogDontShowAgainRequest,
    ChangelogLinkRequest,
    CloseChangelogRequest,
    ContentEntry,
} from "../../../sharedInterfaces/changelog";
import { getActionIcon } from "../../common/icons/iconUtils";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useChangelogSelector } from "./changelogSelector";

const changelogIcons: Record<string, string> = {
    "azureDataStudio.svg": require("../../media/azureDataStudio.svg"),
};

const mssqlExtensionIcon = require("../../../../images/extensionIcon.png");

const useStyles = makeStyles({
    root: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
    },
    page: {
        flex: "1 1 auto",
        overflowY: "auto",
        boxSizing: "border-box",
        ...shorthands.padding("16px", "18px", "16px", "18px"),
    },
    shell: {
        width: "100%",
        maxWidth: "1040px",
        minHeight: "100%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "22px",
    },
    headerBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        paddingBottom: "12px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        "@media (max-width: 900px)": {
            flexDirection: "column",
            alignItems: "stretch",
        },
    },
    headerMain: {
        display: "flex",
        alignItems: "center",
        minWidth: 0,
    },
    headerTitleWrap: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
        minWidth: 0,
    },
    headerIcon: {
        width: "42px",
        height: "42px",
        objectFit: "contain",
        display: "block",
        flexShrink: 0,
        borderRadius: "6px",
    },
    headerTitle: {
        margin: 0,
        fontSize: "18px",
        fontWeight: 600,
        lineHeight: "24px",
        letterSpacing: "-0.01em",
        color: "var(--vscode-foreground)",
    },
    versionBadge: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: "22px",
        padding: "0 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: tokens.colorBrandForegroundLink,
        border: `1px solid color-mix(in srgb, ${tokens.colorBrandForegroundLink} 24%, transparent)`,
        fontFamily: "var(--vscode-editor-font-family), monospace",
        textTransform: "uppercase",
    },
    layout: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 260px",
        gap: "30px",
        alignItems: "start",
        flex: "1 1 auto",
        minHeight: 0,
        "@media (max-width: 1000px)": {
            gridTemplateColumns: "1fr",
        },
    },
    mainColumn: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        minWidth: 0,
    },
    sectionHeaderRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: 0,
    },
    sectionHeading: {
        margin: 0,
    },
    highlightList: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    featureRow: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "12px",
        alignItems: "start",
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
        transitionProperty: "background-color, border-color",
        transitionDuration: "120ms",
        transitionTimingFunction: "ease",
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            border: "1px solid var(--vscode-editorWidget-border)",
        },
    },
    featureIconWrap: {
        width: "20px",
        height: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: "1px",
    },
    featureIconWrapRight: {
        justifySelf: "end",
        alignSelf: "center",
    },
    featureImage: {
        width: "20px",
        height: "20px",
        objectFit: "contain",
        display: "block",
    },
    featureBody: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    featureTitleRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        minWidth: 0,
    },
    featureTitle: {
        minWidth: 0,
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "18px",
        letterSpacing: "-0.01em",
        color: "var(--vscode-foreground)",
    },
    previewChip: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: "20px",
        padding: "0 7px",
        borderRadius: "999px",
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: tokens.colorPaletteBerryForeground1,
        border: `1px solid color-mix(in srgb, ${tokens.colorPaletteBerryForeground1} 24%, transparent)`,
        fontFamily: "var(--vscode-editor-font-family), monospace",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
    },
    featureDescription: {
        margin: 0,
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-descriptionForeground)",
    },
    codeSnippet: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: "18px",
        ...shorthands.padding("0", "4px"),
        borderRadius: "4px",
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        color: "var(--vscode-symbolIcon-classForeground)",
    },
    actionRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: "14px",
        alignItems: "center",
    },
    inlineAction: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "16px",
    },
    secondaryAccordion: {
        backgroundColor: "transparent",
        width: "100%",
    },
    secondaryAccordionItem: {
        backgroundColor: "transparent",
        border: "none",
    },
    secondaryAccordionHeader: {
        padding: 0,
        minHeight: "unset",
        width: "100%",
        color: "var(--vscode-foreground)",
        ":hover": {
            backgroundColor: "transparent",
        },
    },
    secondaryHeaderContent: {
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    secondaryAccordionPanel: {
        padding: "10px 0 0 0",
    },
    secondaryDescription: {
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-descriptionForeground)",
    },
    secondaryGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "10px",
        "@media (max-width: 720px)": {
            gridTemplateColumns: "1fr",
        },
    },
    secondaryCard: {
        minWidth: 0,
        borderRadius: "10px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    secondaryCardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
    secondaryIconWrap: {
        width: "18px",
        height: "18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    secondaryImage: {
        width: "18px",
        height: "18px",
        objectFit: "contain",
        display: "block",
    },
    secondaryTitle: {
        minWidth: 0,
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "18px",
        color: "var(--vscode-foreground)",
    },
    secondaryCardDescription: {
        margin: 0,
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-descriptionForeground)",
    },
    sidebarColumn: {
        position: "sticky",
        top: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        "@media (max-width: 1000px)": {
            position: "static",
        },
    },
    sidebarCard: {
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
        padding: "16px",
    },
    sidebarTitle: {
        margin: "0 0 6px 0",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "16px",
        letterSpacing: "0.01em",
    },
    sidebarDescription: {
        margin: "0 0 10px 0",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-descriptionForeground)",
    },
    sidebarActions: {
        display: "flex",
        flexDirection: "column",
    },
    sidebarAction: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minHeight: "34px",
        padding: "6px 0",
        fontSize: "12px",
        lineHeight: "16px",
        color: "var(--vscode-textLink-foreground)",
        ":not(:last-child)": {
            borderBottom:
                "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 70%, transparent)",
        },
    },
    footerViewport: {
        flex: "0 0 auto",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editor-background)",
        boxShadow: "0 -8px 18px rgba(0, 0, 0, 0.08)",
    },
    footerBar: {
        width: "100%",
        maxWidth: "1076px",
        margin: "0 auto",
        boxSizing: "border-box",
        paddingTop: "14px",
        paddingRight: "18px",
        paddingBottom: "8px",
        paddingLeft: "18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
    },
    footerText: {
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--vscode-descriptionForeground)",
    },
    footerActions: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
    },
    closeButton: {
        minWidth: "72px",
    },
    footerDismiss: {
        color: "var(--vscode-textLink-foreground)",
    },
});

export const ChangelogPage = () => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview();
    const mainContent = useChangelogSelector((s) => s?.mainContent);
    const secondaryContent = useChangelogSelector((s) => s?.secondaryContent);
    const sidebarContent = useChangelogSelector((s) => s?.sidebarContent) ?? [];
    const version = useChangelogSelector((s) => s?.version) ?? "unknown";

    const mainEntries = mainContent?.entries ?? [];
    const secondaryEntries = secondaryContent?.entries ?? [];
    const mainTitle = mainContent?.title ?? locConstants.changelog.highlightsSectionTitle;
    const secondaryTitle = secondaryContent?.title ?? "";
    const secondaryDescription = secondaryContent?.description;
    const secondaryAccordionValue = "in-case-you-missed-it";

    const [secondaryOpenItems, setSecondaryOpenItems] = useState<string[]>([]);
    const [secondarySectionElement, setSecondarySectionElement] = useState<HTMLDivElement>();
    const secondarySectionRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            setSecondarySectionElement(element);
        }
    }, []);

    const openLink = async (url: string) => {
        await extensionRpc.sendRequest(ChangelogLinkRequest.type, { url });
    };

    const handleAction = async (params: ChangelogCommandRequestParams) => {
        await extensionRpc.sendRequest(ChangelogCommandRequest.type, params);
    };

    const openWalkthrough = async (walkthroughId: string, args: unknown[] = []) => {
        await extensionRpc.sendRequest(ChangelogCommandRequest.type, {
            commandId: "workbench.action.openWalkthrough",
            args: [walkthroughId, ...args],
        });
    };

    const handleSecondaryToggle = (_event: unknown, data: { openItems: Iterable<unknown> }) => {
        const nextOpenItems = Array.from(data.openItems, (item) => String(item));
        const wasClosed = !secondaryOpenItems.includes(secondaryAccordionValue);
        const isOpen = nextOpenItems.includes(secondaryAccordionValue);

        setSecondaryOpenItems(nextOpenItems);

        if (wasClosed && isOpen) {
            requestAnimationFrame(() => {
                secondarySectionElement?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            });
        }
    };

    const renderDescription = (keyPrefix: string, description: string, codeSnippets?: string[]) => {
        if (!codeSnippets || codeSnippets.length === 0) {
            return description;
        }

        const parts: (string | React.JSX.Element)[] = [];
        let lastIndex = 0;
        const regex = /\{code-snippet-(\d+)\}/g;
        let match;

        // eslint-disable-next-line no-restricted-syntax
        while ((match = regex.exec(description)) !== null) {
            if (match.index > lastIndex) {
                parts.push(description.slice(lastIndex, match.index));
            }

            const snippetIndex = parseInt(match[1], 10);
            if (snippetIndex < codeSnippets.length) {
                parts.push(
                    <span
                        key={`${keyPrefix}-snippet-${snippetIndex}`}
                        className={classes.codeSnippet}>
                        {codeSnippets[snippetIndex]}
                    </span>,
                );
            }

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < description.length) {
            parts.push(description.slice(lastIndex));
        }

        return parts;
    };

    const renderActionLink = (
        action: ChangelogAction,
        key: string,
        className: string,
        showTrailingArrow: boolean,
        leadingIcon?: React.ReactElement,
    ) => {
        const content = (
            <>
                {leadingIcon}
                <span>{action.label}</span>
                {showTrailingArrow && <ArrowRight12Regular />}
            </>
        );

        if (action.type === "link") {
            return (
                <Link key={key} className={className} onClick={() => openLink(action.value)}>
                    {content}
                </Link>
            );
        }

        if (action.type === "walkthrough") {
            return (
                <Link
                    key={key}
                    className={className}
                    onClick={() => openWalkthrough(action.value, action.args)}>
                    {content}
                </Link>
            );
        }

        return (
            <Link
                key={key}
                className={className}
                onClick={() =>
                    handleAction({
                        commandId: action.value,
                        args: action.args,
                    })
                }>
                {content}
            </Link>
        );
    };

    const renderHighlightEntry = (entry: ContentEntry, index: number) => {
        const changeIcon = entry.icon ? changelogIcons[entry.icon] : undefined;
        const iconSize = entry.icon === "azureDataStudio.svg" ? 32 : 20;

        return (
            <div
                key={`${entry.title}-${index}`}
                className={classes.featureRow}
                style={{
                    ...(changeIcon ? { gridTemplateColumns: `minmax(0, 1fr) ${iconSize}px` } : {}),
                }}>
                <div className={classes.featureBody}>
                    <div className={classes.featureTitleRow}>
                        <span className={classes.featureTitle}>{entry.title}</span>
                        {entry.isPreview && (
                            <span className={classes.previewChip}>
                                {locConstants.changelog.previewBadge}
                            </span>
                        )}
                    </div>
                    <Text className={classes.featureDescription}>
                        {renderDescription(
                            `highlight-${index}`,
                            entry.description,
                            entry.codeSnippets,
                        )}
                    </Text>
                    {entry.actions && entry.actions.length > 0 && (
                        <div className={classes.actionRow}>
                            {entry.actions.map((action, actionIndex) =>
                                renderActionLink(
                                    action,
                                    `highlight-${index}-${action.label}-${actionIndex}`,
                                    classes.inlineAction,
                                    true,
                                ),
                            )}
                        </div>
                    )}
                </div>
                {changeIcon && (
                    <div
                        className={`${classes.featureIconWrap} ${classes.featureIconWrapRight}`}
                        style={{ width: `${iconSize}px`, height: `${iconSize}px` }}>
                        <img
                            className={classes.featureImage}
                            src={changeIcon}
                            alt=""
                            style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                        />
                    </div>
                )}
            </div>
        );
    };

    const renderSecondaryEntry = (entry: ContentEntry, index: number) => {
        const changeIcon = entry.icon ? changelogIcons[entry.icon] : undefined;

        return (
            <div key={`${entry.title}-${index}`} className={classes.secondaryCard}>
                <div className={classes.secondaryCardHeader}>
                    {changeIcon && (
                        <div className={classes.secondaryIconWrap}>
                            <img className={classes.secondaryImage} src={changeIcon} alt="" />
                        </div>
                    )}
                    <div className={classes.featureTitleRow}>
                        <span className={classes.secondaryTitle}>{entry.title}</span>
                        {entry.isPreview && (
                            <span className={classes.previewChip}>
                                {locConstants.changelog.previewBadge}
                            </span>
                        )}
                    </div>
                </div>
                <Text className={classes.secondaryCardDescription}>
                    {renderDescription(`missed-${index}`, entry.description, entry.codeSnippets)}
                </Text>
                {entry.actions && entry.actions.length > 0 && (
                    <div className={classes.actionRow}>
                        {entry.actions.map((action, actionIndex) =>
                            renderActionLink(
                                action,
                                `missed-${index}-${action.label}-${actionIndex}`,
                                classes.inlineAction,
                                true,
                            ),
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={classes.root}>
            <div className={classes.page}>
                <div className={classes.shell}>
                    <div className={classes.headerBar}>
                        <div className={classes.headerMain}>
                            <div className={classes.headerTitleWrap}>
                                <img
                                    className={classes.headerIcon}
                                    src={mssqlExtensionIcon}
                                    alt={locConstants.changelog.headerIconAlt}
                                />
                                <h1 className={classes.headerTitle}>
                                    {locConstants.changelog.pageTitle}
                                </h1>
                                <span className={classes.versionBadge}>{`v${version}`}</span>
                            </div>
                        </div>
                    </div>

                    <div className={classes.layout}>
                        <div className={classes.mainColumn}>
                            <div>
                                <div className={classes.sectionHeaderRow}>
                                    <h3 className={classes.sectionHeading}>{mainTitle}</h3>
                                </div>
                            </div>

                            <div className={classes.highlightList}>
                                {mainEntries.map(renderHighlightEntry)}
                            </div>

                            <div ref={secondarySectionRef}>
                                <Accordion
                                    collapsible
                                    openItems={secondaryOpenItems}
                                    onToggle={handleSecondaryToggle}
                                    className={classes.secondaryAccordion}>
                                    <AccordionItem
                                        value={secondaryAccordionValue}
                                        className={classes.secondaryAccordionItem}>
                                        <AccordionHeader
                                            className={classes.secondaryAccordionHeader}
                                            button={{ style: { paddingLeft: 0 } }}>
                                            <div className={classes.secondaryHeaderContent}>
                                                <div className={classes.sectionHeaderRow}>
                                                    <h3 className={classes.sectionHeading}>
                                                        {secondaryTitle}
                                                    </h3>
                                                </div>
                                                {secondaryDescription && (
                                                    <div className={classes.secondaryDescription}>
                                                        {secondaryDescription}
                                                    </div>
                                                )}
                                            </div>
                                        </AccordionHeader>
                                        <AccordionPanel className={classes.secondaryAccordionPanel}>
                                            <div className={classes.secondaryGrid}>
                                                {secondaryEntries.map(renderSecondaryEntry)}
                                            </div>
                                        </AccordionPanel>
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        </div>

                        <div className={classes.sidebarColumn}>
                            {sidebarContent.map((entry, index) => (
                                <div
                                    key={`${entry.title}-${index}`}
                                    className={classes.sidebarCard}>
                                    <h3 className={classes.sidebarTitle}>{entry.title}</h3>
                                    {entry.description && (
                                        <p className={classes.sidebarDescription}>
                                            {entry.description}
                                        </p>
                                    )}
                                    <div className={classes.sidebarActions}>
                                        {entry.actions?.map((action, actionIndex) =>
                                            renderActionLink(
                                                action,
                                                `sidebar-${index}-${action.label}-${actionIndex}`,
                                                classes.sidebarAction,
                                                false,
                                                getActionIcon(action.icon),
                                            ),
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className={classes.footerViewport}>
                <div className={classes.footerBar}>
                    <Text className={classes.footerText}>
                        {locConstants.changelog.footerText(version)}
                    </Text>
                    <div className={classes.footerActions}>
                        <Button
                            appearance="outline"
                            size="small"
                            className={classes.closeButton}
                            onClick={async () => {
                                await extensionRpc.sendRequest(CloseChangelogRequest.type);
                            }}>
                            {locConstants.changelog.close}
                        </Button>
                        <Button
                            appearance="transparent"
                            size="small"
                            className={classes.footerDismiss}
                            onClick={async () => {
                                await extensionRpc.sendRequest(ChangelogDontShowAgainRequest.type);
                            }}>
                            {locConstants.changelog.dontShowAgain}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

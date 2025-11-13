/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    Link,
    Text,
    Title3,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { ArrowRight12Regular, Dismiss12Filled, Open16Regular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";

import {
    ChangelogCommandRequest,
    ChangelogCommandRequestParams,
    ChangelogDontShowAgainRequest,
    ChangelogLinkRequest,
    CloseChangelogRequest,
} from "../../../sharedInterfaces/changelog";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { useChangelogSelector } from "./changelogSelector";
import { locConstants, LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        height: "100%",
        maxWidth: "1200px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
    },
    page: {
        flex: "1 0 auto", // grow and take available space above footer
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        ...shorthands.padding("12px", "16px", "5px", "16px"),
        height: "100%",
        boxSizing: "border-box",
    },
    bannerContainer: {
        position: "relative",
        borderRadius: "8px",
        maxHeight: "200px",
        overflowY: "auto",
        overflowX: "hidden",
        backgroundColor: "transparent",
    },
    banner: {
        position: "relative",
        padding: "15px",
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: "24px",
        width: "100%",
        boxSizing: "border-box",
        backgroundColor: "transparent",
        "@media (max-width: 900px)": {
            gridTemplateColumns: "1fr",
        },
        "::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            backgroundColor: "var(--vscode-button-background)",
            opacity: 0.1,
            zIndex: 0,
            pointerEvents: "none",
        },
    },
    bannerTitle: {
        fontSize: "14px",
        fontWeight: 600,
        color: "var(--vscode-editor-foreground)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        zIndex: 1,
    },
    bannerDismiss: {
        position: "absolute",
        top: "8px",
        right: "8px",
        minWidth: 0,
        zIndex: 1,
    },
    bannerDescription: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        justifyContent: "center",
        position: "relative",
        zIndex: 1,
    },
    codeSnippet: {
        backgroundColor: "var(--vscode-editor-background)",
        padding: "2px 4px",
        borderRadius: "4px",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        color: "var(--vscode-symbolIcon-classForeground)",
    },
    mainGrid: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 2.5fr) minmax(260px, 1.5fr)",
        gap: "24px",
        width: "100%",
        "@media (max-width: 900px)": {
            gridTemplateColumns: "1fr",
        },
        overflowY: "auto",
        flex: "1",
    },
    changesColumn: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    changeCard: {
        backgroundColor: "var(--vscode-sideBar-background)",
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        padding: "15px",
    },
    changeTitle: {
        margin: 0,
        fontSize: "16px",
        fontWeight: 600,
    },
    changeDescription: {
        margin: "8px 0 12px",
        color: "var(--vscode-descriptionForeground)",
    },
    changeActions: {
        display: "flex",
        flexWrap: "wrap",
        gap: "16px",
    },
    sidebarStack: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    sidebarCard: {
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
        padding: "15px",
        overflowY: "auto",
    },
    list: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    listItem: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    actionLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontWeight: 600,
    },
    footer: {
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        flex: 0,
        padding: "5px",
        fontSize: "12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "10px",
    },
});

export const ChangelogPage = () => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview2();
    const state = useChangelogSelector((s) => s ?? {});
    const changes = state?.changes ?? [];
    const resources = state?.resources ?? [];
    const walkthroughs = state?.walkthroughs ?? [];

    const [showBanner, setShowBanner] = useState(true);

    const sectionTitles = useMemo(() => LocConstants.getInstance().changelog, []);

    const openLink = async (url: string) => {
        await extensionRpc.sendRequest(ChangelogLinkRequest.type, {
            url: url,
        });
    };

    const handleAction = async (params: ChangelogCommandRequestParams) => {
        await extensionRpc.sendRequest(ChangelogCommandRequest.type, params);
    };

    const openWalkthrough = async (walkthroughId: string, stepId?: string) => {
        const args = stepId ? [stepId] : [];
        await extensionRpc.sendRequest(ChangelogCommandRequest.type, {
            commandId: "workbench.action.openWalkthrough",
            args: [walkthroughId, ...args],
        });
    };

    const isSqlConOver = () => {
        const sqlConEndDate = new Date("2026-03-21T00:00:00Z");
        const currentDate = new Date();
        return currentDate > sqlConEndDate;
    };

    const renderDescription = (index: number, description: string, codeSnippets?: string[]) => {
        if (!codeSnippets || codeSnippets.length === 0) {
            return description;
        }

        const parts: (string | JSX.Element)[] = [];
        let lastIndex = 0;
        const regex = /\{code-snippet-(\d+)\}/g;
        let match;

        while ((match = regex.exec(description)) !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
                parts.push(description.slice(lastIndex, match.index));
            }

            // Add the code snippet
            const snippetIndex = parseInt(match[1], 10);
            if (snippetIndex < codeSnippets.length) {
                parts.push(
                    <span key={`snippet-${index}-${snippetIndex}`} className={classes.codeSnippet}>
                        {codeSnippets[snippetIndex]}
                    </span>,
                );
            }

            lastIndex = regex.lastIndex;
        }

        // Add remaining text
        if (lastIndex < description.length) {
            parts.push(description.slice(lastIndex));
        }

        return parts;
    };

    return (
        <div className={classes.root}>
            <div className={classes.page}>
                {showBanner && !isSqlConOver() && (
                    <div className={classes.bannerContainer}>
                        <div className={classes.banner}>
                            <div className={classes.bannerTitle}>
                                <Text
                                    size={600}
                                    weight="bold"
                                    style={{
                                        backgroundImage:
                                            "linear-gradient(to right in oklab, var(--vscode-button-hoverBackground, var(--vscode-contrastBorder)) 0%, var(--vscode-button-background, var(--vscode-editor-background)) 100%)",
                                        backgroundClip: "text",
                                        WebkitBackgroundClip: "text",
                                        color: "transparent",
                                    }}>
                                    SQLCON
                                </Text>
                                <Text
                                    size={300}
                                    weight="semibold"
                                    style={{
                                        marginTop: "5px",
                                    }}>
                                    Microsoft SQL
                                </Text>
                                <Text size={300} weight="semibold">
                                    COMMUNITY CONFERENCE
                                </Text>
                                <Text size={200} weight="regular" style={{ marginTop: "5px" }}>
                                    March 16-20, 2026 | ATLANTA
                                </Text>
                                <Button
                                    style={{
                                        marginTop: "10px",
                                        width: "100px",
                                    }}
                                    onClick={() => openLink("https://aka.ms/sqlcon")}
                                    appearance="primary">
                                    Register
                                </Button>
                            </div>
                            <div className={classes.bannerDescription}>
                                <Text>
                                    Discover how SQL database in Fabric, Azure SQL and SQL Server
                                    are redefining modern app development.
                                    <br /> Join engineers and peers pushing the limits of
                                    performance, Al integration, and developer productivity.
                                </Text>
                                <Text>
                                    Use code <span className={classes.codeSnippet}>VSCODE-200</span>
                                    to get your exclusive VS Code discount
                                </Text>
                            </div>
                            <Button
                                appearance="transparent"
                                icon={<Dismiss12Filled />}
                                className={classes.bannerDismiss}
                                onClick={() => {
                                    setShowBanner(false);
                                }}></Button>
                        </div>
                    </div>
                )}
                <Title3 as="h2">{sectionTitles.whatsNewSectionTitle}</Title3>
                <div className={classes.mainGrid}>
                    <div className={classes.changesColumn}>
                        {changes.map((change, index) => {
                            return (
                                <Card
                                    key={`${change.title}-${index}`}
                                    className={classes.changeCard}>
                                    <h3 className={classes.changeTitle}>{change.title}</h3>
                                    <Text className={classes.changeDescription}>
                                        {renderDescription(
                                            index,
                                            change.description,
                                            change.codeSnippets,
                                        )}
                                    </Text>
                                    {change.actions && change.actions.length > 0 && (
                                        <div className={classes.changeActions}>
                                            {change.actions.map((action, idx) => {
                                                if (action.type === "link") {
                                                    return (
                                                        <Link
                                                            key={`${action.label}-${idx}`}
                                                            className={classes.actionLink}
                                                            onClick={() => openLink(action.value)}>
                                                            {action.label}
                                                            <ArrowRight12Regular />
                                                        </Link>
                                                    );
                                                } else if (action.type === "command") {
                                                    return (
                                                        <Link
                                                            key={`${action.label}-${idx}`}
                                                            className={classes.actionLink}
                                                            onClick={() =>
                                                                handleAction({
                                                                    commandId: action.value,
                                                                    args: action.args,
                                                                })
                                                            }>
                                                            {action.label}
                                                            <ArrowRight12Regular />
                                                        </Link>
                                                    );
                                                }
                                            })}
                                        </div>
                                    )}
                                </Card>
                            );
                        })}
                    </div>

                    <div className={classes.sidebarStack}>
                        <Card className={classes.sidebarCard}>
                            <h3 className={classes.changeTitle}>
                                {sectionTitles.resourcesSectionTitle}
                            </h3>

                            <div className={classes.list}>
                                {resources.map((resource, index) => (
                                    <Link
                                        key={`${resource.label}-${index}`}
                                        className={classes.listItem}
                                        onClick={() => openLink(resource.url)}>
                                        <Open16Regular />
                                        {resource.label}
                                    </Link>
                                ))}
                            </div>
                        </Card>

                        <Card className={classes.sidebarCard}>
                            <h3 className={classes.changeTitle}>
                                {sectionTitles.gettingStartedSectionTitle}
                            </h3>
                            <Text>{locConstants.changelog.gettingStartedDescription}</Text>
                            <div className={classes.list}>
                                {walkthroughs.map((walkthrough, index) => (
                                    <Link
                                        key={`${walkthrough.label}-${index}`}
                                        className={classes.listItem}
                                        onClick={async () => {
                                            if (walkthrough.url) {
                                                await openLink(walkthrough.url);
                                            } else if (walkthrough.walkthroughId) {
                                                await openWalkthrough(
                                                    walkthrough.walkthroughId,
                                                    walkthrough.stepId,
                                                );
                                            }
                                        }}>
                                        <Open16Regular />
                                        {walkthrough.label}
                                    </Link>
                                ))}
                            </div>
                        </Card>
                    </div>
                </div>
                <div className={classes.footer}>
                    <Text>{locConstants.changelog.footerText(state.version)}</Text>
                    <div
                        style={{
                            display: "flex",
                            gap: "20px",
                        }}>
                        <Link
                            type="button"
                            onClick={async () => {
                                await extensionRpc.sendRequest(CloseChangelogRequest.type);
                            }}>
                            {locConstants.changelog.close}
                        </Link>
                        <Link
                            type="button"
                            onClick={async () => {
                                await extensionRpc.sendRequest(ChangelogDontShowAgainRequest.type);
                            }}>
                            {locConstants.changelog.dontShowAgain}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

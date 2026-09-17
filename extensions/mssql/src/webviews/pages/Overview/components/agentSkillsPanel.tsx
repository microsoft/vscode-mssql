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
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    MessageBar,
    Spinner,
    MessageBarActions,
    MessageBarBody,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Copy16Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";

import { AgentSkillsIcon } from "../../../common/icons/agentSkills";
import { PromptCard, getPromptCards } from "../overviewContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
    },
    card: {
        display: "flex",
        flexDirection: "column",
        padding: "14px 15px",
        border: `1px solid ${tokens.colorBrandStroke2}`,
        borderRadius: "10px",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    cardTop: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
    },
    tile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "34px",
        height: "34px",
        flexShrink: 0,
        borderRadius: "8px",
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
    },
    cardTitles: {
        flexGrow: 1,
        minWidth: 0,
    },
    nameRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13.5px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    recommended: {
        fontSize: "10px",
        fontWeight: tokens.fontWeightBold,
        letterSpacing: "0.2px",
        padding: "1px 7px",
        borderRadius: "9px",
        color: tokens.colorPaletteGreenForeground1,
        backgroundColor: tokens.colorPaletteGreenBackground1,
        border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
    },
    meta: {
        display: "flex",
        alignItems: "center",
        gap: "7px",
        marginTop: "3px",
        fontSize: "11.5px",
        color: tokens.colorNeutralForeground3,
    },
    description: {
        margin: "8px 0 0",
        maxWidth: "620px",
        fontSize: "12px",
        lineHeight: "1.5",
        color: tokens.colorNeutralForeground2,
    },
    tintedButton: {
        flexShrink: 0,
        fontSize: "11px",
        padding: "3px 12px",
        borderRadius: "5px",
        color: tokens.colorBrandForeground2,
        backgroundColor: tokens.colorBrandBackground2,
        border: `1px solid ${tokens.colorBrandStroke2}`,
        minWidth: "unset",
    },
    promptSummary: {
        "& button": {
            fontSize: "11.5px",
            fontWeight: tokens.fontWeightSemibold,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: tokens.colorNeutralForeground3,
        },
    },
    promptDialog: {
        maxWidth: "620px",
    },
    promptDialogDescription: {
        display: "block",
        marginBottom: tokens.spacingVerticalM,
        color: tokens.colorNeutralForeground3,
    },
    // The prompt is meant to be read and copied verbatim, so it keeps its own wrapping.
    promptDialogText: {
        margin: 0,
        padding: tokens.spacingVerticalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    promptNotice: {
        marginBottom: tokens.spacingVerticalM,
    },
    promptGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "10px",
        maxWidth: "840px",
        "@media (max-width: 700px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
        },
    },
    promptCard: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "2px",
        padding: "12px 13px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "9px",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    promptTag: {
        fontSize: "9px",
        fontWeight: tokens.fontWeightBold,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: "5px",
        color: tokens.colorBrandForeground2,
        backgroundColor: tokens.colorBrandBackground2,
    },
    promptTitle: {
        marginTop: "5px",
        fontSize: "13px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    promptDescription: {
        fontSize: "11.5px",
        lineHeight: "1.45",
        color: tokens.colorNeutralForeground2,
    },
    promptFooter: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginTop: "9px",
    },
    ghostButton: {
        fontSize: "11px",
        padding: "4px 10px",
        borderRadius: "6px",
        color: tokens.colorNeutralForeground2,
        backgroundColor: "transparent",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        minWidth: "unset",
    },
});

export const AgentSkillsPanel = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { installAgentSkillsPlugin } = useOverviewActions();
    const hasAgentSkillsPlugin = useOverviewSelector((state) => state.hasAgentSkillsPlugin);
    // The install runs in VS Code behind a trust prompt, so the button has to say something
    // between the click and the manifest changing, or it reads as having done nothing.
    const [isInstalling, setIsInstalling] = useState(false);
    // The prompt is the whole point of the card, so viewing it stays in the page rather than
    // sending the reader to a repository to find it.
    const [viewedPrompt, setViewedPrompt] = useState<PromptCard | undefined>(undefined);

    useEffect(() => {
        if (hasAgentSkillsPlugin) {
            setIsInstalling(false);
        }
    }, [hasAgentSkillsPlugin]);

    // The prompt may simply be dismissed, in which case nothing ever arrives; give up in step
    // with the extension host so the button does not sit spinning forever.
    useEffect(() => {
        if (!isInstalling) {
            return;
        }
        const timer = setTimeout(() => setIsInstalling(false), 120_000);
        return () => clearTimeout(timer);
    }, [isInstalling]);

    const startInstall = () => {
        setIsInstalling(true);
        installAgentSkillsPlugin();
    };
    const [copiedId, setCopiedId] = useState<string | undefined>(undefined);

    const copy = async (id: string, text: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
    };

    return (
        <div className={classes.root}>
            <div className={classes.card}>
                <div className={classes.cardTop}>
                    <span className={classes.tile}>
                        <AgentSkillsIcon />
                    </span>
                    <div className={classes.cardTitles}>
                        <div className={classes.nameRow}>
                            {loc.agentSkillsName}
                            <span className={classes.recommended}>{loc.recommended}</span>
                        </div>
                        <div className={classes.meta}>
                            {`${loc.agentSkillsTab} · ${loc.agentSkillsPublisher}`}
                        </div>
                    </div>
                    <Button
                        appearance="primary"
                        disabled={hasAgentSkillsPlugin || isInstalling}
                        icon={isInstalling ? <Spinner size="tiny" /> : undefined}
                        onClick={startInstall}>
                        {hasAgentSkillsPlugin
                            ? loc.agentSkillsInstalled
                            : isInstalling
                              ? loc.agentSkillsInstalling
                              : loc.addToGitHubCopilot}
                    </Button>
                </div>
                <Text className={classes.description}>{loc.agentSkillsDescription}</Text>
            </div>

            {/* Collapsed by default: the prompts are a secondary aid, not the primary content. */}
            <Accordion collapsible>
                <AccordionItem value="prompts">
                    <AccordionHeader className={classes.promptSummary}>
                        {loc.tryThesePrompts}
                    </AccordionHeader>
                    <AccordionPanel>
                        {!hasAgentSkillsPlugin && (
                            <MessageBar intent="info" className={classes.promptNotice}>
                                <MessageBarBody>{loc.agentSkillsNotInstalled}</MessageBarBody>
                                <MessageBarActions>
                                    <Button
                                        size="small"
                                        disabled={isInstalling}
                                        onClick={startInstall}>
                                        {isInstalling
                                            ? loc.agentSkillsInstalling
                                            : loc.addToGitHubCopilot}
                                    </Button>
                                </MessageBarActions>
                            </MessageBar>
                        )}
                        <div className={classes.promptGrid}>
                            {getPromptCards().map((card) => (
                                <div key={card.id} className={classes.promptCard}>
                                    <span className={classes.promptTag}>{card.tag}</span>
                                    <Text className={classes.promptTitle}>{card.title}</Text>
                                    <Text className={classes.promptDescription}>
                                        {card.description}
                                    </Text>
                                    <div className={classes.promptFooter}>
                                        <Button
                                            className={classes.tintedButton}
                                            icon={<Copy16Regular />}
                                            onClick={() => void copy(card.id, card.prompt)}>
                                            {copiedId === card.id
                                                ? loc.promptCopied
                                                : loc.copyPrompt}
                                        </Button>
                                        <Button
                                            className={classes.ghostButton}
                                            onClick={() => setViewedPrompt(card)}>
                                            {loc.view}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>

            {viewedPrompt && (
                <Dialog
                    open
                    onOpenChange={(_event, data) => !data.open && setViewedPrompt(undefined)}>
                    <DialogSurface className={classes.promptDialog}>
                        <DialogBody>
                            <DialogTitle>{viewedPrompt.title}</DialogTitle>
                            <DialogContent>
                                <Text className={classes.promptDialogDescription}>
                                    {viewedPrompt.description}
                                </Text>
                                <pre className={classes.promptDialogText}>
                                    {viewedPrompt.prompt}
                                </pre>
                            </DialogContent>
                            <DialogActions>
                                <Button
                                    appearance="secondary"
                                    onClick={() => setViewedPrompt(undefined)}>
                                    {locConstants.common.close}
                                </Button>
                                <Button
                                    appearance="primary"
                                    icon={<Copy16Regular />}
                                    onClick={() => void copy(viewedPrompt.id, viewedPrompt.prompt)}>
                                    {copiedId === viewedPrompt.id
                                        ? loc.promptCopied
                                        : loc.copyPrompt}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
};

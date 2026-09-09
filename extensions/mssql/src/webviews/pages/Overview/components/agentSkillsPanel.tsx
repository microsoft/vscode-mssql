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
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Copy16Regular, Open16Regular } from "@fluentui/react-icons";
import { useState } from "react";

import { AgentSkillsIcon } from "../../../common/icons/agentSkills";
import { agentSkillsCliCommand, getPromptCards, overviewLinks } from "../overviewContent";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

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
    cliAccordion: {
        marginTop: "9px",
    },
    cliHeader: {
        "& button": {
            fontSize: "11px",
            color: tokens.colorNeutralForeground3,
        },
    },
    cliRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "5px 8px",
        border: `1px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: "6px",
        backgroundColor: tokens.colorNeutralBackground3,
    },
    cliCommand: {
        flexGrow: 1,
        minWidth: 0,
        margin: 0,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
        // The command is long by design; it scrolls rather than wrapping to six lines.
        whiteSpace: "nowrap",
        overflowX: "auto",
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
    const { openLink } = useOverviewActions();
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
                        onClick={() => openLink(overviewLinks.skillsRepository)}>
                        {loc.addToGitHubCopilot}
                    </Button>
                </div>
                <Text className={classes.description}>{loc.agentSkillsDescription}</Text>
                <Accordion collapsible className={classes.cliAccordion}>
                    <AccordionItem value="cli">
                        <AccordionHeader className={classes.cliHeader}>
                            {loc.installWithCli}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={classes.cliRow}>
                                <pre className={classes.cliCommand}>{agentSkillsCliCommand}</pre>
                                <Button
                                    className={classes.tintedButton}
                                    onClick={() => void copy("cli", agentSkillsCliCommand)}>
                                    {copiedId === "cli"
                                        ? locConstants.common.copied
                                        : locConstants.common.copy}
                                </Button>
                            </div>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>

            {/* Collapsed by default: the prompts are a secondary aid, not the primary content. */}
            <Accordion collapsible>
                <AccordionItem value="prompts">
                    <AccordionHeader className={classes.promptSummary}>
                        {loc.tryThesePrompts}
                    </AccordionHeader>
                    <AccordionPanel>
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
                                            icon={<Open16Regular />}
                                            iconPosition="after"
                                            onClick={() => openLink(card.url)}>
                                            {loc.view}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>
        </div>
    );
};

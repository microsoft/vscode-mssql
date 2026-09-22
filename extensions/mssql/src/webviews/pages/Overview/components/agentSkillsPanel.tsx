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
    Input,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Spinner,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Checkmark16Regular,
    CheckmarkCircle16Filled,
    ChevronDown16Regular,
    ChevronRight16Regular,
    Copy16Regular,
    Open16Regular,
    Search16Regular,
    TextBulletListSquare16Regular,
} from "@fluentui/react-icons";
import { ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    AgentSkillGroup,
    AgentSkillSummary,
    OverviewTelemetryEvent,
} from "../../../../sharedInterfaces/overview";
import { AgentSkillsIcon } from "../../../common/icons/agentSkills";
import { GithubCopilot16Regular } from "../../../common/icons/fluentIcons";
import { SqlMigrationIcon } from "../../../common/icons/sqlMigration";
import { locConstants } from "../../../common/locConstants";
import { AgentSkillPack, PromptCard, getAgentSkillPacks } from "../overviewContent";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

/** How long the copy button acknowledges a copy before returning to its resting label. */
const COPY_FEEDBACK_MS = 2000;

/** Above this many skills, scrolling the list stops being a practical way to find one. */
const FILTER_THRESHOLD = 10;

const packIcons: Record<AgentSkillPack["icon"], ComponentType> = {
    agentSkills: AgentSkillsIcon,
    sqlMigration: SqlMigrationIcon,
};

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        transition: "border-color 120ms ease",
        ":hover": {
            borderTopColor: tokens.colorNeutralStroke1,
            borderRightColor: tokens.colorNeutralStroke1,
            borderBottomColor: tokens.colorNeutralStroke1,
            borderLeftColor: tokens.colorNeutralStroke1,
        },
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        "@media (max-width: 700px)": {
            alignItems: "flex-start",
            flexWrap: "wrap",
        },
    },
    tile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "36px",
        height: "36px",
        flexShrink: 0,
        borderRadius: "8px",
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
    },
    cardTitles: {
        flexGrow: 1,
        minWidth: "180px",
    },
    name: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
        color: tokens.colorNeutralForeground1,
    },
    meta: {
        marginTop: "2px",
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    installAction: {
        flexShrink: 0,
    },
    // Reads as a state, not as a button that has stopped working, which is how a disabled
    // primary button reads once the skills are in place.
    installedBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        flexShrink: 0,
        padding: "5px 10px",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
        backgroundColor: tokens.colorPaletteGreenBackground1,
        color: tokens.colorPaletteGreenForeground1,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    description: {
        margin: "10px 0 0",
        maxWidth: "760px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground2,
    },
    cardActions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        marginTop: "14px",
        paddingTop: "10px",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke3,
        flexWrap: "wrap",
    },
    // Pushed to the trailing edge so the disclosure reads as the card's own control rather than
    // as a third link.
    promptToggle: {
        marginInlineStart: "auto",
    },
    prompts: {
        marginTop: tokens.spacingVerticalM,
    },
    promptNotice: {
        marginBottom: tokens.spacingVerticalM,
    },
    promptGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "10px",
        "@media (max-width: 700px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
        },
    },
    promptCard: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: "8px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        transition: "border-color 120ms ease",
        ":hover": {
            borderTopColor: tokens.colorNeutralStroke1,
            borderRightColor: tokens.colorNeutralStroke1,
            borderBottomColor: tokens.colorNeutralStroke1,
            borderLeftColor: tokens.colorNeutralStroke1,
        },
    },
    promptTag: {
        fontSize: "10px",
        fontWeight: tokens.fontWeightBold,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: "5px",
        color: tokens.colorBrandForeground2,
        backgroundColor: tokens.colorBrandBackground2,
    },
    promptTitle: {
        marginTop: "8px",
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground1,
    },
    promptDescription: {
        marginTop: "3px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
    },
    // `auto` keeps the footers of two cards in the same row aligned even when their titles wrap
    // to different heights.
    promptFooter: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        marginTop: "auto",
        paddingTop: "12px",
    },
    // `DialogActions` sits in the dialog grid's auto column and lets its buttons shrink, which
    // breaks a two-word label across two lines.
    dialogAction: {
        flexShrink: 0,
        whiteSpace: "nowrap",
    },
    promptAction: {
        whiteSpace: "nowrap",
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
    skillsDialog: {
        width: "min(760px, calc(100vw - 32px))",
        maxWidth: "760px",
    },
    // The toolbar has to stay put while the list moves, so the scrolling happens one level in
    // rather than here. Sticky inside this box leaves a gap at the top -- `DialogContent` is
    // inset by a 2px focus-ring padding, and rows scroll through it above the sticky element.
    skillsDialogContent: {
        overflowY: "visible",
    },
    skillsScroll: {
        maxHeight: "min(55vh, 620px)",
        overflowY: "auto",
    },
    skillsStatus: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "140px",
    },
    // Held above the scrolling list: with 57 skills the count and the filter are the controls
    // you reach for once you are already well down the list.
    skillsToolbar: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        paddingBottom: tokens.spacingVerticalS,
        marginBottom: tokens.spacingVerticalXS,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke3,
        flexWrap: "wrap",
    },
    skillsCount: {
        color: tokens.colorNeutralForeground3,
    },
    skillsFilter: {
        marginInlineStart: "auto",
        minWidth: "220px",
    },
    skillsEmpty: {
        display: "block",
        padding: `${tokens.spacingVerticalXXL} 0`,
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
    skillList: {
        display: "flex",
        flexDirection: "column",
        margin: 0,
        padding: 0,
        listStyleType: "none",
    },
    skillItem: {
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke3,
        ":last-child": {
            borderBottomStyle: "none",
        },
    },
    // The whole row is the target, so a skill and its description are one thing to click rather
    // than a link with loose text underneath it.
    skillRow: {
        display: "block",
        width: "100%",
        height: "auto",
        padding: "10px 12px",
        borderRadius: tokens.borderRadiusMedium,
        fontWeight: tokens.fontWeightRegular,
        textAlign: "left",
        whiteSpace: "normal",
    },
    skillRowBody: {
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        width: "100%",
        minWidth: 0,
    },
    skillRowName: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    skillName: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    skillOpenIcon: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    skillDescription: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground2,
    },
});

interface SkillPackCardProps {
    pack: AgentSkillPack;
    isInstalled: boolean;
    isInstalling: boolean;
    copiedPromptId: string | undefined;
    onInstall: () => void;
    onOpenSkills: (pack: AgentSkillPack) => void;
    onCopyPrompt: (card: PromptCard) => void;
    onOpenPromptInChat: (card: PromptCard) => void;
    onViewPrompt: (card: PromptCard) => void;
}

const SkillPackCard = ({
    pack,
    isInstalled,
    isInstalling,
    copiedPromptId,
    onInstall,
    onOpenSkills,
    onCopyPrompt,
    onOpenPromptInChat,
    onViewPrompt,
}: SkillPackCardProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();
    const [arePromptsOpen, setArePromptsOpen] = useState(false);
    const promptsId = `${pack.id}-prompts`;
    const PackIcon = packIcons[pack.icon];

    return (
        <div className={classes.card}>
            <div className={classes.cardHeader}>
                <span className={classes.tile}>
                    <PackIcon />
                </span>
                <div className={classes.cardTitles}>
                    <div className={classes.name}>{pack.name}</div>
                    <div className={classes.meta}>{loc.agentSkillsMeta(pack.publisher)}</div>
                </div>
                {isInstalled ? (
                    <span className={classes.installedBadge}>
                        <CheckmarkCircle16Filled />
                        {loc.agentSkillsInstalled}
                    </span>
                ) : (
                    <Button
                        appearance="primary"
                        className={classes.installAction}
                        disabled={isInstalling}
                        icon={isInstalling ? <Spinner size="tiny" /> : <GithubCopilot16Regular />}
                        onClick={onInstall}>
                        {isInstalling ? loc.agentSkillsInstalling : loc.addToGitHubCopilot}
                    </Button>
                )}
            </div>
            <Text className={classes.description}>{pack.description}</Text>
            <div className={classes.cardActions}>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<Open16Regular />}
                    onClick={() => openLink(pack.repositoryUrl)}>
                    {loc.agentSkillsRepository}
                </Button>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<TextBulletListSquare16Regular />}
                    onClick={() => onOpenSkills(pack)}>
                    {loc.viewAgentSkills}
                </Button>
                <Button
                    appearance="subtle"
                    size="small"
                    className={classes.promptToggle}
                    aria-expanded={arePromptsOpen}
                    aria-controls={promptsId}
                    icon={arePromptsOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                    onClick={() => setArePromptsOpen((open) => !open)}>
                    {loc.tryThesePrompts}
                </Button>
            </div>

            {arePromptsOpen && (
                <div className={classes.prompts} id={promptsId}>
                    {!isInstalled && (
                        <MessageBar intent="info" className={classes.promptNotice}>
                            <MessageBarBody>
                                {loc.agentSkillsNotInstalled(pack.name)}
                            </MessageBarBody>
                            <MessageBarActions>
                                <Button
                                    size="small"
                                    disabled={isInstalling}
                                    icon={
                                        isInstalling ? (
                                            <Spinner size="tiny" />
                                        ) : (
                                            <GithubCopilot16Regular />
                                        )
                                    }
                                    onClick={onInstall}>
                                    {isInstalling
                                        ? loc.agentSkillsInstalling
                                        : loc.addToGitHubCopilot}
                                </Button>
                            </MessageBarActions>
                        </MessageBar>
                    )}
                    <div className={classes.promptGrid}>
                        {pack.prompts.map((card) => (
                            <div key={card.id} className={classes.promptCard}>
                                <span className={classes.promptTag}>{card.tag}</span>
                                <Text className={classes.promptTitle}>{card.title}</Text>
                                <Text className={classes.promptDescription}>
                                    {card.description}
                                </Text>
                                <div className={classes.promptFooter}>
                                    <Button
                                        appearance="primary"
                                        size="small"
                                        className={classes.promptAction}
                                        icon={<GithubCopilot16Regular />}
                                        onClick={() => onOpenPromptInChat(card)}>
                                        {loc.openPromptInCopilot}
                                    </Button>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        className={classes.promptAction}
                                        icon={
                                            copiedPromptId === card.id ? (
                                                <Checkmark16Regular />
                                            ) : (
                                                <Copy16Regular />
                                            )
                                        }
                                        onClick={() => onCopyPrompt(card)}>
                                        {copiedPromptId === card.id
                                            ? loc.promptCopied
                                            : loc.copyPrompt}
                                    </Button>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        className={classes.promptAction}
                                        onClick={() => onViewPrompt(card)}>
                                        {loc.view}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const SkillList = ({ skills }: { skills: AgentSkillSummary[] }) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();

    return (
        <ul className={classes.skillList}>
            {skills.map((skill) => (
                <li key={skill.id} className={classes.skillItem}>
                    <Button
                        appearance="subtle"
                        className={classes.skillRow}
                        title={loc.viewSkillSource}
                        onClick={() => openLink(skill.repositoryUrl)}>
                        <span className={classes.skillRowBody}>
                            <span className={classes.skillRowName}>
                                <span className={classes.skillName}>{skill.id}</span>
                                <Open16Regular className={classes.skillOpenIcon} />
                            </span>
                            <span className={classes.skillDescription}>{skill.description}</span>
                        </span>
                    </Button>
                </li>
            ))}
        </ul>
    );
};

const SkillsCatalog = ({ groups }: { groups: AgentSkillGroup[] }) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const [filter, setFilter] = useState("");

    const total = useMemo(
        () => groups.reduce((count, group) => count + group.skills.length, 0),
        [groups],
    );

    const filtered = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (needle.length === 0) {
            return groups;
        }
        return groups
            .map((group) => ({
                ...group,
                skills: group.skills.filter(
                    (skill) =>
                        skill.id.toLowerCase().includes(needle) ||
                        skill.description.toLowerCase().includes(needle),
                ),
            }))
            .filter((group) => group.skills.length > 0);
    }, [filter, groups]);

    const shown = filtered.reduce((count, group) => count + group.skills.length, 0);
    const isFiltering = filter.trim().length > 0;

    return (
        <>
            <div className={classes.skillsToolbar}>
                <Text className={classes.skillsCount}>
                    {isFiltering
                        ? loc.agentSkillsFilterMatches(shown, total)
                        : loc.agentSkillsCount(total)}
                </Text>
                {total > FILTER_THRESHOLD && (
                    <Input
                        className={classes.skillsFilter}
                        size="small"
                        value={filter}
                        contentBefore={<Search16Regular />}
                        placeholder={loc.agentSkillsFilterPlaceholder}
                        onChange={(_event, data) => setFilter(data.value)}
                    />
                )}
            </div>
            <div className={classes.skillsScroll}>
                {shown === 0 ? (
                    <Text className={classes.skillsEmpty}>{loc.agentSkillsNoMatches}</Text>
                ) : filtered.length === 1 ? (
                    // One collection is the common case, and an accordion wrapped around the only
                    // group is a click that never reveals anything new.
                    <SkillList skills={filtered[0].skills} />
                ) : (
                    <Accordion
                        multiple
                        collapsible
                        defaultOpenItems={filtered.map((group) => group.id)}>
                        {filtered.map((group) => (
                            <AccordionItem key={group.id} value={group.id}>
                                <AccordionHeader>
                                    {`${group.title} (${group.skills.length})`}
                                </AccordionHeader>
                                <AccordionPanel>
                                    <SkillList skills={group.skills} />
                                </AccordionPanel>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}
            </div>
        </>
    );
};

export const AgentSkillsPanel = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { getAgentSkillsCatalog, installAgentSkillsPlugin, openPromptInChat, sendTelemetry } =
        useOverviewActions();
    const hasAgentSkillsPlugin = useOverviewSelector((state) => state.hasAgentSkillsPlugin);
    // Downloading takes a moment, so the button has to say something between the click and the
    // state arriving, or it reads as having done nothing.
    const [isInstalling, setIsInstalling] = useState(false);
    const [viewedPrompt, setViewedPrompt] = useState<PromptCard | undefined>(undefined);
    const [copiedId, setCopiedId] = useState<string | undefined>(undefined);
    const [skillsDialogPack, setSkillsDialogPack] = useState<AgentSkillPack | undefined>(undefined);
    const [skillGroups, setSkillGroups] = useState<AgentSkillGroup[] | undefined>(undefined);
    const [isLoadingSkills, setIsLoadingSkills] = useState(false);
    const [skillsLoadFailed, setSkillsLoadFailed] = useState(false);
    const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const packs = useMemo(() => getAgentSkillPacks(), []);

    useEffect(() => {
        if (hasAgentSkillsPlugin) {
            setIsInstalling(false);
        }
    }, [hasAgentSkillsPlugin]);

    useEffect(() => () => clearTimeout(copyResetRef.current), []);

    const startInstall = useCallback(() => {
        setIsInstalling(true);
        void installAgentSkillsPlugin().finally(() => setIsInstalling(false));
    }, [installAgentSkillsPlugin]);

    const copyPrompt = useCallback(
        (card: PromptCard) => {
            sendTelemetry(OverviewTelemetryEvent.PromptCopied, card.id);
            void navigator.clipboard.writeText(card.prompt).then(() => {
                setCopiedId(card.id);
                clearTimeout(copyResetRef.current);
                copyResetRef.current = setTimeout(() => setCopiedId(undefined), COPY_FEEDBACK_MS);
            });
        },
        [sendTelemetry],
    );

    const openInChat = useCallback(
        (card: PromptCard) => {
            sendTelemetry(OverviewTelemetryEvent.PromptOpenedInChat, card.id);
            void openPromptInChat(card.prompt);
        },
        [openPromptInChat, sendTelemetry],
    );

    const viewPrompt = useCallback(
        (card: PromptCard) => {
            sendTelemetry(OverviewTelemetryEvent.PromptViewed, card.id);
            setViewedPrompt(card);
        },
        [sendTelemetry],
    );

    const loadSkills = useCallback(async () => {
        setIsLoadingSkills(true);
        setSkillsLoadFailed(false);
        try {
            setSkillGroups(await getAgentSkillsCatalog());
        } catch {
            setSkillsLoadFailed(true);
        } finally {
            setIsLoadingSkills(false);
        }
    }, [getAgentSkillsCatalog]);

    const openSkills = useCallback(
        (pack: AgentSkillPack) => {
            setSkillsDialogPack(pack);
            if (!skillGroups && !isLoadingSkills) {
                void loadSkills();
            }
        },
        [isLoadingSkills, loadSkills, skillGroups],
    );

    return (
        <div className={classes.root}>
            {packs.map((pack) => (
                <SkillPackCard
                    key={pack.id}
                    pack={pack}
                    isInstalled={hasAgentSkillsPlugin}
                    isInstalling={isInstalling}
                    copiedPromptId={copiedId}
                    onInstall={startInstall}
                    onOpenSkills={openSkills}
                    onCopyPrompt={copyPrompt}
                    onOpenPromptInChat={openInChat}
                    onViewPrompt={viewPrompt}
                />
            ))}

            <Dialog
                open={skillsDialogPack !== undefined}
                onOpenChange={(_event, data) => !data.open && setSkillsDialogPack(undefined)}>
                <DialogSurface className={classes.skillsDialog}>
                    <DialogBody>
                        <DialogTitle>{skillsDialogPack?.name}</DialogTitle>
                        <DialogContent className={classes.skillsDialogContent}>
                            {isLoadingSkills ? (
                                <div className={classes.skillsStatus}>
                                    <Spinner label={loc.agentSkillsLoading} />
                                </div>
                            ) : skillsLoadFailed ? (
                                <div className={classes.skillsStatus}>
                                    <MessageBar intent="error">
                                        <MessageBarBody>{loc.agentSkillsLoadFailed}</MessageBarBody>
                                    </MessageBar>
                                </div>
                            ) : skillGroups ? (
                                <SkillsCatalog groups={skillGroups} />
                            ) : undefined}
                        </DialogContent>
                        <DialogActions>
                            {skillsLoadFailed && (
                                <Button
                                    appearance="secondary"
                                    className={classes.dialogAction}
                                    onClick={() => void loadSkills()}>
                                    {loc.retry}
                                </Button>
                            )}
                            <Button
                                appearance="secondary"
                                className={classes.dialogAction}
                                onClick={() => setSkillsDialogPack(undefined)}>
                                {locConstants.common.close}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

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
                                    className={classes.dialogAction}
                                    onClick={() => setViewedPrompt(undefined)}>
                                    {locConstants.common.close}
                                </Button>
                                <Button
                                    appearance="secondary"
                                    className={classes.dialogAction}
                                    icon={
                                        copiedId === viewedPrompt.id ? (
                                            <Checkmark16Regular />
                                        ) : (
                                            <Copy16Regular />
                                        )
                                    }
                                    onClick={() => copyPrompt(viewedPrompt)}>
                                    {copiedId === viewedPrompt.id
                                        ? loc.promptCopied
                                        : loc.copyPrompt}
                                </Button>
                                <Button
                                    appearance="primary"
                                    className={classes.dialogAction}
                                    icon={<GithubCopilot16Regular />}
                                    onClick={() => {
                                        openInChat(viewedPrompt);
                                        setViewedPrompt(undefined);
                                    }}>
                                    {loc.openPromptInCopilot}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
};

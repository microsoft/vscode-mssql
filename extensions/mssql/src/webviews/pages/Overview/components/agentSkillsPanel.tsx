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
    Input,
    Link,
    MessageBar,
    MessageBarBody,
    Spinner,
    Text,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Checkmark16Regular,
    CheckmarkCircle16Filled,
    ChevronDown16Regular,
    ChevronRight16Regular,
    Copy16Regular,
    Search16Regular,
    TextBulletListSquare16Regular,
} from "@fluentui/react-icons";
import {
    ComponentType,
    ReactElement,
    ReactNode,
    SVGProps,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    AgentSkillGroup,
    AgentSkillSummary,
    OverviewTelemetryEvent,
} from "../../../../sharedInterfaces/overview";
import { AgentSkillsIcon } from "../../../common/icons/agentSkills";
import { DialogShell } from "./dialogShell";
import { GithubCopilot16Regular, GithubMark16Regular } from "../../../common/icons/fluentIcons";
import { SqlMigrationIcon } from "../../../common/icons/sqlMigration";
import { locConstants } from "../../../common/locConstants";
import { AgentSkillPack, PromptCard, getAgentSkillPacks } from "../overviewContent";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

/** How long the copy button acknowledges a copy before returning to its resting label. */
const COPY_FEEDBACK_MS = 2000;

/** Above this many skills, scrolling the list stops being a practical way to find one. */
const FILTER_THRESHOLD = 10;

const packIcons: Record<AgentSkillPack["icon"], ComponentType<SVGProps<SVGSVGElement>>> = {
    agentSkills: AgentSkillsIcon,
    sqlMigration: SqlMigrationIcon,
};

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    // The cards used to start straight after the tabs, which left no answer to "what are these?".
    intro: {
        color: tokens.colorNeutralForeground3,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        padding: "18px",
        borderRadius: tokens.borderRadiusLarge,
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
    cardHeader: {
        display: "flex",
        // The tile tops out with the title rather than centring against the whole text block.
        alignItems: "flex-start",
        gap: "14px",
        "@media (max-width: 700px)": {
            alignItems: "flex-start",
            flexWrap: "wrap",
        },
    },
    tile: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "48px",
        height: "48px",
        flexShrink: 0,
        borderRadius: "12px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground1,
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
    // Keeps the installed state legible now that the label says Manage rather than Installed.
    installedIcon: {
        color: tokens.colorPaletteGreenForeground1,
    },
    description: {
        margin: "8px 0 0",
        // Holds the measure the mockup wraps at, rather than stretching to the card's width.
        maxWidth: "520px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground2,
    },
    cardActions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        marginTop: "16px",
        flexWrap: "wrap",
    },
    cardLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: tokens.fontSizeBase200,
    },
    cardLinkDivider: {
        width: "1px",
        height: "14px",
        flexShrink: 0,
        backgroundColor: tokens.colorNeutralStroke2,
    },
    // Pushed to the trailing edge so the disclosure reads as the card's own control rather than
    // as a third link.
    promptToggle: {
        marginInlineStart: "auto",
    },
    prompts: {
        marginTop: tokens.spacingVerticalM,
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
        borderRadius: tokens.borderRadiusMedium,
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
        padding: `${tokens.spacingVerticalS} 0`,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke3,
        ":last-child": {
            borderBottomStyle: "none",
        },
    },
    // The name carries the link on its own, so the row needs no trailing icon to say it opens
    // somewhere: the colour and the underline on hover already do.
    skillName: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        textAlign: "left",
    },
    skillDescription: {
        display: "block",
        marginTop: "3px",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground2,
    },
    skillSearchMatch: {
        backgroundColor: "var(--vscode-editor-findMatchBackground)",
        color: "var(--vscode-editor-findMatchForeground, inherit)",
        borderRadius: tokens.borderRadiusSmall,
    },
});

/** Highlights every literal, case-insensitive occurrence of the current filter. */
const highlightSkillSearch = (value: string, filter: string, className: string): ReactNode => {
    const search = filter.trim().toLowerCase();
    if (!search) {
        return value;
    }

    const lowerValue = value.toLowerCase();
    const parts: ReactNode[] = [];
    let position = 0;
    let matchIndex = lowerValue.indexOf(search, position);
    while (matchIndex !== -1) {
        parts.push(value.slice(position, matchIndex));
        parts.push(
            <mark key={matchIndex} className={className}>
                {value.slice(matchIndex, matchIndex + search.length)}
            </mark>,
        );
        position = matchIndex + search.length;
        matchIndex = lowerValue.indexOf(search, position);
    }
    parts.push(value.slice(position));
    return parts;
};

/**
 * Explains why a prompt action does nothing until the pack is installed.
 *
 * The control it wraps uses `disabledFocusable` rather than `disabled`, so it still takes hover
 * and focus and can say why: a plain disabled button is silent to both a pointer and a screen
 * reader, which is the whole reason the banner used to be there.
 */
const PromptAction = ({
    isInstalled,
    children,
}: {
    isInstalled: boolean;
    children: ReactElement;
}) =>
    isInstalled ? (
        children
    ) : (
        <Tooltip
            content={locConstants.overview.promptsNeedSkills}
            relationship="description"
            withArrow>
            {children}
        </Tooltip>
    );

interface SkillPackCardProps {
    pack: AgentSkillPack;
    /** Live count once the catalog resolves; undefined while it is still being fetched. */
    skillCount: number | undefined;
    isInstalled: boolean;
    isInstalling: boolean;
    /** Whether this is the pack whose Install button was pressed. */
    isInstallTarget: boolean;
    copiedPromptId: string | undefined;
    onInstall: () => void;
    onManage: () => void;
    onOpenSkills: (pack: AgentSkillPack) => void;
    onCopyPrompt: (card: PromptCard) => void;
    onOpenPromptInChat: (card: PromptCard) => void;
}

const SkillPackCard = ({
    pack,
    skillCount,
    isInstallTarget,
    isInstalled,
    isInstalling,
    copiedPromptId,
    onInstall,
    onManage,
    onOpenSkills,
    onCopyPrompt,
    onOpenPromptInChat,
}: SkillPackCardProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();
    const [arePromptsOpen, setArePromptsOpen] = useState(false);
    // Opened on the transition into installed, not whenever the pack happens to be installed:
    // a card that arrives already installed stays closed, and so does one the user collapsed.
    const wasInstalled = useRef(isInstalled);
    useEffect(() => {
        if (isInstalled && !wasInstalled.current && isInstallTarget) {
            setArePromptsOpen(true);
        }
        wasInstalled.current = isInstalled;
    }, [isInstalled, isInstallTarget]);
    const promptsId = `${pack.id}-prompts`;
    const PackIcon = packIcons[pack.icon];
    const isThisInstalling = isInstalling && isInstallTarget;

    return (
        <div className={classes.card}>
            <div className={classes.cardHeader}>
                <span className={classes.tile}>
                    <PackIcon />
                </span>
                <div className={classes.cardTitles}>
                    <div className={classes.name}>{pack.name}</div>
                    <div className={classes.meta}>
                        {skillCount === undefined
                            ? loc.agentSkillsPlugin
                            : loc.agentSkillsMeta(skillCount)}
                    </div>
                    <Text className={classes.description}>{pack.description}</Text>
                </div>
                {isInstalled ? (
                    // Once it is in, the useful thing to offer is the Extensions view entry that
                    // can disable or remove it, rather than a badge with nothing behind it.
                    <Button
                        appearance="secondary"
                        className={classes.installAction}
                        icon={<CheckmarkCircle16Filled className={classes.installedIcon} />}
                        onClick={onManage}>
                        {loc.manageAgentSkillsPlugin}
                    </Button>
                ) : (
                    <Button
                        appearance="primary"
                        className={classes.installAction}
                        disabled={isInstalling}
                        icon={
                            isThisInstalling ? <Spinner size="tiny" /> : <GithubCopilot16Regular />
                        }
                        onClick={onInstall}>
                        {isThisInstalling ? loc.agentSkillsInstalling : loc.addToGitHubCopilot}
                    </Button>
                )}
            </div>
            <div className={classes.cardActions}>
                <Link as="button" className={classes.cardLink} onClick={() => onOpenSkills(pack)}>
                    <TextBulletListSquare16Regular />
                    {loc.viewAgentSkills}
                </Link>
                <span className={classes.cardLinkDivider} aria-hidden="true" />
                <Link
                    as="button"
                    className={classes.cardLink}
                    onClick={() => openLink(pack.repositoryUrl)}>
                    <GithubMark16Regular />
                    {loc.agentSkillsRepository}
                </Link>
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
                    <div className={classes.promptGrid}>
                        {pack.prompts.map((card) => (
                            <div key={card.id} className={classes.promptCard}>
                                <span className={classes.promptTag}>{card.tag}</span>
                                <Text className={classes.promptTitle}>{card.title}</Text>
                                <Text className={classes.promptDescription}>
                                    {card.description}
                                </Text>
                                <div className={classes.promptFooter}>
                                    <PromptAction isInstalled={isInstalled}>
                                        <Button
                                            appearance="primary"
                                            size="small"
                                            className={classes.promptAction}
                                            disabledFocusable={!isInstalled}
                                            icon={<GithubCopilot16Regular />}
                                            onClick={() => onOpenPromptInChat(card)}>
                                            {loc.openPromptInCopilot}
                                        </Button>
                                    </PromptAction>
                                    <PromptAction isInstalled={isInstalled}>
                                        <Button
                                            appearance="subtle"
                                            size="small"
                                            className={classes.promptAction}
                                            disabledFocusable={!isInstalled}
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
                                    </PromptAction>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const SkillList = ({ skills, filter }: { skills: AgentSkillSummary[]; filter: string }) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openLink } = useOverviewActions();

    return (
        <ul className={classes.skillList}>
            {skills.map((skill) => (
                <li key={skill.id} className={classes.skillItem}>
                    <Link
                        as="button"
                        className={classes.skillName}
                        title={loc.viewSkillSource}
                        onClick={() => openLink(skill.repositoryUrl)}>
                        {highlightSkillSearch(skill.id, filter, classes.skillSearchMatch)}
                    </Link>
                    <Text className={classes.skillDescription}>
                        {highlightSkillSearch(skill.description, filter, classes.skillSearchMatch)}
                    </Text>
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
                    <SkillList skills={filtered[0].skills} filter={filter} />
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
                                    <SkillList skills={group.skills} filter={filter} />
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
    const {
        getAgentSkillsCatalog,
        installAgentSkillsPlugin,
        manageAgentSkillsPlugin,
        openPromptInChat,
        sendTelemetry,
    } = useOverviewActions();
    const hasAgentSkillsPlugin = useOverviewSelector((state) => state.hasAgentSkillsPlugin);
    const hasMigrationSkillsPlugin = useOverviewSelector((state) => state.hasMigrationSkillsPlugin);
    // Downloading takes a moment, so the button has to say something between the click and the
    // state arriving, or it reads as having done nothing.
    const [isInstalling, setIsInstalling] = useState(false);
    // Which card's Install button started the install in flight.
    const [installingPackId, setInstallingPackId] = useState<string | undefined>(undefined);
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

    const startInstall = useCallback(
        (packId: AgentSkillPack["id"]) => {
            setInstallingPackId(packId);
            setIsInstalling(true);
            void installAgentSkillsPlugin(packId).finally(() => setIsInstalling(false));
        },
        [installAgentSkillsPlugin],
    );

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

    // The cards state a real number, so the catalog is loaded with the page rather than only
    // when the dialog opens. It is the same request either way and the installer caches it for
    // the window, so this costs one README fetch and keeps the card and the dialog in agreement.
    useEffect(() => {
        void loadSkills();
    }, [loadSkills]);

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
            <Text className={classes.intro}>{loc.agentSkillsIntro}</Text>
            {packs.map((pack) => (
                <SkillPackCard
                    key={pack.id}
                    pack={pack}
                    // Falls back to the authored count only when the catalog cannot be reached,
                    // so the card never shows a number the dialog will contradict.
                    skillCount={
                        skillGroups?.find((group) => group.id === pack.id)?.skills.length ??
                        (skillsLoadFailed ? pack.skillCount : undefined)
                    }
                    isInstalled={
                        pack.id === "microsoft-sql"
                            ? hasAgentSkillsPlugin
                            : hasMigrationSkillsPlugin
                    }
                    isInstalling={isInstalling}
                    isInstallTarget={installingPackId === pack.id}
                    copiedPromptId={copiedId}
                    onInstall={() => startInstall(pack.id)}
                    onManage={() => void manageAgentSkillsPlugin(pack.id)}
                    onOpenSkills={openSkills}
                    onCopyPrompt={copyPrompt}
                    onOpenPromptInChat={openInChat}
                />
            ))}

            <Dialog
                open={skillsDialogPack !== undefined}
                onOpenChange={(_event, data) => !data.open && setSkillsDialogPack(undefined)}>
                <DialogShell
                    title={skillsDialogPack?.name}
                    className={classes.skillsDialog}
                    contentClassName={classes.skillsDialogContent}
                    onDismiss={() => setSkillsDialogPack(undefined)}
                    actions={
                        <>
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
                        </>
                    }>
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
                        <SkillsCatalog
                            groups={skillGroups.filter(
                                (group) => group.id === skillsDialogPack?.id,
                            )}
                        />
                    ) : undefined}
                </DialogShell>
            </Dialog>
        </div>
    );
};

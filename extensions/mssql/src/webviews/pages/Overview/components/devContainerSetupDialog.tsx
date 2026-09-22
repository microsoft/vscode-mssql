/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    Dropdown,
    Input,
    Label,
    Link,
    Option,
    Radio,
    RadioGroup,
    Spinner,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowClockwise16Regular,
    Box24Regular,
    CheckmarkCircle16Filled,
    Open16Regular,
    Warning16Filled,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { DevContainerTemplate, getTemplateSourceUrl, overviewLinks } from "../overviewContent";
import {
    DevContainerPrerequisites,
    DevContainerTarget,
    DevContainerTemplateOption,
    OverviewExtensionId,
    PrerequisiteStatus,
} from "../../../../sharedInterfaces/overview";
import { DialogShell } from "./dialogShell";
import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

const useStyles = makeStyles({
    surface: {
        // Wide enough that the prerequisite rows and the action buttons stay on one line each.
        maxWidth: "620px",
    },
    // A grid rather than the radio group's own column, so every option gets the height of the
    // tallest: a description that wraps to two lines would otherwise leave the cards uneven.
    choices: {
        display: "grid",
        gridAutoRows: "1fr",
        gap: tokens.spacingVerticalS,
    },
    // Each location is a card the whole width of the dialog, so the choice reads as two options
    // rather than two lines of text with a control in front of them.
    choice: {
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    },
    choiceSelected: {
        // Restated as the same shorthand the base rule uses, so the override replaces it
        // cleanly -- the longhand `borderColor` is not one Griffel accepts.
        border: `1px solid ${tokens.colorCompoundBrandStroke}`,
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    // The radio's own label is replaced, so it has to carry the two-line block itself.
    choiceRadio: {
        width: "100%",
        alignItems: "flex-start",
    },
    choiceText: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    choiceTitle: {
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    choiceDescription: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    prerequisitesHeading: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
    },
    actionButton: {
        minWidth: "112px",
        whiteSpace: "nowrap",
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        padding: tokens.spacingVerticalS,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    rowText: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        flexGrow: 1,
        minWidth: 0,
    },
    rowTitle: {
        fontWeight: tokens.fontWeightSemibold,
    },
    rowDescription: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    status: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        fontSize: tokens.fontSizeBase200,
    },
    ready: {
        color: tokens.colorPaletteGreenForeground1,
    },
    missing: {
        color: tokens.colorPaletteYellowForeground1,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    options: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    locationRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    // Sized like one option card, so settling into the real content is a swap rather than a
    // jump. The card styling is deliberately absent: it is not something to choose yet.
    loadingRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        minHeight: "52px",
        paddingLeft: tokens.spacingHorizontalM,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    failureActions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        flexShrink: 0,
    },
    locationInput: {
        flexGrow: 1,
        minWidth: 0,
    },
    option: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    optionLabel: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    // Sits in the footer band: the auto margin is what holds it left while the buttons stay
    // right, without the band having to know it is there.
    learnMore: {
        display: "inline-flex",
        alignItems: "center",
        marginRight: "auto",
        gap: tokens.spacingHorizontalXXS,
        fontSize: "13px",
    },
});

/** Ties the label to its dropdown; option ids come from the template, so they are namespaced. */
function optionControlId(option: DevContainerTemplateOption): string {
    return `dev-container-option-${option.id}`;
}

/** Marks the template's own default, so the choice on offer is legible without opening the list. */
function optionText(option: DevContainerTemplateOption, value: string | undefined): string {
    const selected = value ?? option.defaultValue;
    return selected === option.defaultValue
        ? locConstants.overview.templateOptionDefault(selected)
        : selected;
}

interface DevContainerSetupDialogProps {
    template: DevContainerTemplate;
    onDismiss: () => void;
}

/**
 * Guided setup for a dev container template: verifies the prerequisites, then hands off to the
 * Dev Containers extension to scaffold the configuration.
 */
export const DevContainerSetupDialog = ({ template, onDismiss }: DevContainerSetupDialogProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const {
        openLink,
        checkPrerequisites,
        openExtension,
        onPrerequisitesChanged,
        addDevContainerConfiguration,
        getDevContainerTemplateOptions,
        getDevContainerTarget,
        browseForDevContainerTarget,
        showLog,
        reopenInContainer,
    } = useOverviewActions();
    const [page, setPage] = useState<"prerequisites" | "setUp">("prerequisites");
    const [isApplying, setIsApplying] = useState(false);
    const [applyFailed, setApplyFailed] = useState(false);
    const [hasFileConflict, setHasFileConflict] = useState(false);
    const [usedPicker, setUsedPicker] = useState(false);
    // The request reports what it wrote, so the step does not hang on "not found" if the
    // folder-watching state lags behind.
    const [applied, setApplied] = useState(false);
    // Reported by the apply, so the final button opens the folder that was actually written
    // rather than whatever the field happens to show afterwards.
    const [appliedTarget, setAppliedTarget] = useState<string | undefined>(undefined);
    const [opensNewFolder, setOpensNewFolder] = useState(false);
    // Prerequisites are only meaningful while this dialog is open, so they stay local to it
    // rather than being pushed through the page's shared state.
    const [prerequisites, setPrerequisites] = useState<DevContainerPrerequisites>({
        docker: PrerequisiteStatus.Unknown,
        devContainersExtension: PrerequisiteStatus.Unknown,
    });
    // What the template lets the user choose, and what they chose. An empty list is the normal
    // answer for a template with nothing to configure, and the answer when the metadata cannot
    // be read, so it renders nothing rather than an error.
    const [templateOptions, setTemplateOptions] = useState<DevContainerTemplateOption[]>([]);
    const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
    // The two places the template could go, held apart so switching between them does not throw
    // away the path the user typed. Both come from one request when the dialog opens.
    const [workspaceFolders, setWorkspaceFolders] = useState<
        DevContainerTarget["workspaceFolders"]
    >([]);
    const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | undefined>();
    const [newFolderPath, setNewFolderPath] = useState("");
    const [prefersWorkspace, setPrefersWorkspace] = useState(true);
    // Both proposals are fetched when the dialog opens. Until they land the sections show a
    // spinner rather than a partial answer -- one radio that quietly becomes two, or no
    // version control at all where one is about to appear.
    const [isLoadingTarget, setIsLoadingTarget] = useState(true);
    const [isLoadingOptions, setIsLoadingOptions] = useState(true);

    /**
     * Derived rather than stored, so the selection can never name an option that is not on
     * offer: preferring a workspace while there is none left the group with nothing selected
     * and no path field, which is a dialog the user cannot get out of.
     */
    const usesWorkspace =
        prefersWorkspace &&
        workspaceFolders.some((folder) => folder.path === selectedWorkspacePath);

    /** Whichever of the two is currently chosen; empty until the proposal arrives. */
    const targetPath = usesWorkspace ? selectedWorkspacePath : newFolderPath;

    useEffect(() => {
        let canceled = false;
        void (async () => {
            let proposed: DevContainerTarget | undefined;
            try {
                proposed = await getDevContainerTarget(template.id);
            } catch {
                // A request the extension host does not answer would otherwise leave the
                // defaults in place forever, with no path and no way to pick one.
                proposed = undefined;
            }
            if (canceled) {
                return;
            }
            // Read defensively rather than stored as it arrives: an unhandled request answers
            // with null, and a field read straight off that answer took the whole dialog down.
            // Empty paths simply leave Next disabled until one is typed or browsed to.
            const folders = Array.isArray(proposed?.workspaceFolders)
                ? proposed.workspaceFolders.filter(
                      (folder): folder is { name: string; path: string } =>
                          typeof folder?.name === "string" && typeof folder?.path === "string",
                  )
                : [];
            setWorkspaceFolders(folders);
            setSelectedWorkspacePath(folders[0]?.path);
            setNewFolderPath(
                typeof proposed?.newFolderPath === "string" ? proposed.newFolderPath : "",
            );
            // The folder already open is the obvious answer whenever there is one.
            setPrefersWorkspace(folders.length > 0);
            setIsLoadingTarget(false);
        })();
        return () => {
            canceled = true;
        };
    }, [getDevContainerTarget, template.id]);

    const browse = async () => {
        const chosen = await browseForDevContainerTarget(targetPath);
        // Dismissing the picker answers with nothing, which arrives as null rather than
        // undefined -- JSON has no undefined -- so the type is what gets checked, not the
        // value. Storing the null is what took the page down.
        if (typeof chosen !== "string" || chosen.length === 0) {
            return;
        }
        // Browsing is how the second option is filled in, so it also selects it.
        setNewFolderPath(chosen);
        setPrefersWorkspace(false);
    };

    useEffect(() => {
        let canceled = false;
        void (async () => {
            // Same reason as the folder picker: a request that answers with nothing hands back
            // null, and this one is iterated immediately below. A request that fails outright
            // costs the dropdown, never the flow -- the template applies with its defaults.
            let options: DevContainerTemplateOption[] = [];
            try {
                options = (await getDevContainerTemplateOptions(template.id)) ?? [];
            } catch {
                options = [];
            }
            // The dialog is dismissable while this is in flight, and the template cannot change
            // under it, so a late answer is simply dropped.
            if (canceled) {
                return;
            }
            setTemplateOptions(options);
            setSelectedOptions(
                Object.fromEntries(options.map((option) => [option.id, option.defaultValue])),
            );
            setIsLoadingOptions(false);
        })();
        return () => {
            canceled = true;
        };
    }, [getDevContainerTemplateOptions, template.id]);

    const checking = (): DevContainerPrerequisites => ({
        docker: PrerequisiteStatus.Checking,
        devContainersExtension: PrerequisiteStatus.Checking,
    });

    const refresh = useCallback(async () => {
        setPrerequisites(checking());
        setPrerequisites(await checkPrerequisites());
    }, [checkPrerequisites]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Installing happens outside the dialog -- on the extension's page, or Docker's installer --
    // so the extension reports the change when it notices rather than waiting for Recheck.
    useEffect(() => onPrerequisitesChanged(setPrerequisites), [onPrerequisitesChanged]);

    const renderStatus = (status: PrerequisiteStatus) => {
        switch (status) {
            case PrerequisiteStatus.Ready:
                return (
                    <span className={`${classes.status} ${classes.ready}`}>
                        <CheckmarkCircle16Filled />
                        {loc.prerequisiteReady}
                    </span>
                );
            case PrerequisiteStatus.Missing:
                return (
                    <span className={`${classes.status} ${classes.missing}`}>
                        <Warning16Filled />
                        {loc.prerequisiteMissing}
                    </span>
                );
            default:
                return (
                    <span className={classes.status}>
                        <Spinner size="extra-tiny" />
                        {loc.prerequisiteChecking}
                    </span>
                );
        }
    };

    // Guards against stacking Docker process spawns from repeated clicks.
    const isChecking =
        prerequisites.docker === PrerequisiteStatus.Checking ||
        prerequisites.devContainersExtension === PrerequisiteStatus.Checking;

    const prerequisitesReady =
        prerequisites.docker === PrerequisiteStatus.Ready &&
        prerequisites.devContainersExtension === PrerequisiteStatus.Ready;

    // A configuration in a different workspace root says nothing about the selected target.
    const configReady = applied;

    // Spins while the CLI runs, then settles on what the run actually reported: the request
    // answers with what it wrote, and the controller re-checks the folder before replying.
    const configStatus = isApplying
        ? PrerequisiteStatus.Checking
        : configReady
          ? PrerequisiteStatus.Ready
          : PrerequisiteStatus.Missing;

    const applyTemplate = useCallback(async () => {
        setIsApplying(true);
        setApplyFailed(false);
        setHasFileConflict(false);
        setUsedPicker(false);
        try {
            const result = await addDevContainerConfiguration(
                template.id,
                selectedOptions,
                targetPath,
            );
            setAppliedTarget(result.targetPath);
            setOpensNewFolder(result.opensNewFolder === true);
            // The request carries the CLI's own message, which is unlocalized and embeds the
            // workspace path. The controller has already logged it, so only the outcome is kept
            // here and the dialog shows a localized string.
            setApplyFailed(result.error !== undefined);
            setHasFileConflict(result.conflict === true);
            setUsedPicker(result.usedPicker);
            setApplied(result.applied);
        } catch {
            // A rejected request (the fallback command or the RPC itself failing) would otherwise
            // leave the step with no error and no Retry button, stranding the flow.
            setApplyFailed(true);
        } finally {
            setIsApplying(false);
        }
    }, [addDevContainerConfiguration, template.id, selectedOptions, targetPath]);

    // Moving to the set-up page starts the scaffolding; the user already committed by pressing
    // Next, so there is no second button to press. The ref keeps a failure from being retried in
    // a loop — retrying is the Retry button's job — while resetting if they step back.
    const hasStartedApply = useRef(false);
    useEffect(() => {
        if (page !== "setUp") {
            hasStartedApply.current = false;
            return;
        }
        if (hasStartedApply.current || configReady) {
            return;
        }
        hasStartedApply.current = true;
        void applyTemplate();
    }, [page, configReady, applyTemplate]);

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DialogShell
                className={classes.surface}
                title={template.name}
                icon={<Box24Regular />}
                subtitle={template.subtitle}
                onDismiss={onDismiss}
                actions={
                    <>
                        {/* Left of the buttons, where it stays reachable without competing
                            with the action the dialog is asking for. */}
                        <Link
                            href={getTemplateSourceUrl(template)}
                            title={getTemplateSourceUrl(template)}
                            className={classes.learnMore}
                            onClick={(event) => {
                                event.preventDefault();
                                openLink(getTemplateSourceUrl(template));
                            }}>
                            {loc.learnMoreAboutTemplate}
                            <Open16Regular />
                        </Link>
                        {page === "prerequisites" ? (
                            <>
                                <Button
                                    appearance="secondary"
                                    className={classes.actionButton}
                                    onClick={onDismiss}>
                                    {locConstants.common.cancel}
                                </Button>
                                <Button
                                    appearance="primary"
                                    className={classes.actionButton}
                                    disabled={!prerequisitesReady || !targetPath?.trim()}
                                    onClick={() => setPage("setUp")}>
                                    {locConstants.common.next}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    appearance="secondary"
                                    className={classes.actionButton}
                                    disabled={isApplying}
                                    onClick={() => setPage("prerequisites")}>
                                    {locConstants.common.back}
                                </Button>
                                <Button
                                    appearance="primary"
                                    className={classes.actionButton}
                                    disabled={!configReady || isApplying}
                                    onClick={() => {
                                        // Reopening reloads the window, tearing down this dialog.
                                        reopenInContainer(appliedTarget);
                                        onDismiss();
                                    }}>
                                    {loc.openVsCodeInContainer}
                                </Button>
                            </>
                        )}
                    </>
                }>
                {page === "prerequisites" && (
                    <>
                        <div className={classes.prerequisitesHeading}>
                            <SectionHeading>{loc.prerequisites}</SectionHeading>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<ArrowClockwise16Regular />}
                                disabled={isChecking}
                                onClick={() => void refresh()}>
                                {loc.recheck}
                            </Button>
                        </div>

                        <div className={classes.row}>
                            <div className={classes.rowText}>
                                <Text className={classes.rowTitle}>{loc.prerequisiteDocker}</Text>
                                <Text className={classes.rowDescription}>
                                    {loc.prerequisiteDockerDescription}
                                </Text>
                            </div>
                            {prerequisites.docker === PrerequisiteStatus.Missing ? (
                                <Button
                                    size="small"
                                    onClick={() => openLink(overviewLinks.dockerDesktop)}>
                                    {loc.install}
                                </Button>
                            ) : (
                                renderStatus(prerequisites.docker)
                            )}
                        </div>

                        <div className={classes.row}>
                            <div className={classes.rowText}>
                                <Text className={classes.rowTitle}>
                                    {loc.prerequisiteDevContainers}
                                </Text>
                                <Text className={classes.rowDescription}>
                                    {loc.prerequisiteDevContainersDescription}
                                </Text>
                            </div>
                            {prerequisites.devContainersExtension === PrerequisiteStatus.Missing ? (
                                <Button
                                    size="small"
                                    onClick={() =>
                                        openExtension(OverviewExtensionId.DevContainers)
                                    }>
                                    {loc.install}
                                </Button>
                            ) : (
                                renderStatus(prerequisites.devContainersExtension)
                            )}
                        </div>

                        <SectionHeading>{loc.templateLocation}</SectionHeading>
                        {isLoadingTarget && (
                            <div className={classes.loadingRow}>
                                <Spinner size="extra-tiny" />
                                {locConstants.common.loadingWithEllipsis}
                            </div>
                        )}
                        {!isLoadingTarget && (
                            <RadioGroup
                                className={classes.choices}
                                value={usesWorkspace ? selectedWorkspacePath : "newFolder"}
                                onChange={(_event, data) => {
                                    setPrefersWorkspace(data.value !== "newFolder");
                                    if (data.value !== "newFolder") {
                                        setSelectedWorkspacePath(data.value);
                                    }
                                }}>
                                {workspaceFolders.map((folder) => (
                                    <div
                                        key={folder.path}
                                        className={mergeClasses(
                                            classes.choice,
                                            usesWorkspace &&
                                                selectedWorkspacePath === folder.path &&
                                                classes.choiceSelected,
                                        )}>
                                        <Radio
                                            className={classes.choiceRadio}
                                            value={folder.path}
                                            label={{
                                                children: (
                                                    <div className={classes.choiceText}>
                                                        <Text className={classes.choiceTitle}>
                                                            {workspaceFolders.length === 1
                                                                ? loc.locationWorkspace
                                                                : folder.name}
                                                        </Text>
                                                        <Text className={classes.choiceDescription}>
                                                            {workspaceFolders.length === 1
                                                                ? loc.locationWorkspaceDescription
                                                                : folder.path}
                                                        </Text>
                                                    </div>
                                                ),
                                            }}
                                        />
                                    </div>
                                ))}

                                <div
                                    className={mergeClasses(
                                        classes.choice,
                                        !usesWorkspace && classes.choiceSelected,
                                    )}>
                                    <Radio
                                        className={classes.choiceRadio}
                                        value="newFolder"
                                        label={{
                                            children: (
                                                <div className={classes.choiceText}>
                                                    <Text className={classes.choiceTitle}>
                                                        {loc.locationNewFolder}
                                                    </Text>
                                                    <Text className={classes.choiceDescription}>
                                                        {loc.locationNewFolderDescription}
                                                    </Text>
                                                </div>
                                            ),
                                        }}
                                    />
                                </div>
                            </RadioGroup>
                        )}

                        {/* Below the options rather than inside one, so choosing between them is
                            a choice between two cards of the same size. */}
                        {!isLoadingTarget && !usesWorkspace && (
                            <div className={classes.option}>
                                <Label
                                    htmlFor="dev-container-location"
                                    className={classes.optionLabel}>
                                    {loc.templateLocationDescription}
                                </Label>
                                <div className={classes.locationRow}>
                                    <Input
                                        id="dev-container-location"
                                        className={classes.locationInput}
                                        value={newFolderPath}
                                        onChange={(_event, data) => setNewFolderPath(data.value)}
                                    />
                                    <Button onClick={() => void browse()}>{loc.browse}</Button>
                                </div>
                            </div>
                        )}

                        {isLoadingOptions && (
                            <>
                                <SectionHeading>{loc.templateOptions}</SectionHeading>
                                <div className={classes.loadingRow}>
                                    <Spinner size="extra-tiny" />
                                    {locConstants.common.loadingWithEllipsis}
                                </div>
                            </>
                        )}

                        {!isLoadingOptions && templateOptions.length > 0 && (
                            <>
                                <SectionHeading>{loc.templateOptions}</SectionHeading>
                                <div className={classes.options}>
                                    {templateOptions.map((option) => (
                                        <div key={option.id} className={classes.option}>
                                            <Label
                                                htmlFor={optionControlId(option)}
                                                className={classes.optionLabel}>
                                                {option.label}
                                            </Label>
                                            <Dropdown
                                                id={optionControlId(option)}
                                                // Fluent needs both: the text shown on the
                                                // closed control, and which option is
                                                // marked selected when it opens.
                                                value={optionText(
                                                    option,
                                                    selectedOptions[option.id],
                                                )}
                                                selectedOptions={[
                                                    selectedOptions[option.id] ??
                                                        option.defaultValue,
                                                ]}
                                                onOptionSelect={(_event, data) => {
                                                    const value = data.optionValue;
                                                    if (value === undefined) {
                                                        return;
                                                    }
                                                    setSelectedOptions((current) => ({
                                                        ...current,
                                                        [option.id]: value,
                                                    }));
                                                }}>
                                                {option.values.map((value) => (
                                                    <Option key={value} value={value}>
                                                        {optionText(option, value)}
                                                    </Option>
                                                ))}
                                            </Dropdown>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}

                {page === "setUp" && (
                    <>
                        <SectionHeading>{loc.devContainerSetUpSteps}</SectionHeading>

                        <div className={classes.row}>
                            <div className={classes.rowText}>
                                <Text className={classes.rowTitle}>{loc.stepAddConfiguration}</Text>
                                <Text className={classes.rowDescription}>
                                    {applyFailed
                                        ? hasFileConflict
                                            ? loc.stepAddConfigurationConflict
                                            : loc.stepAddConfigurationFailed
                                        : loc.stepAddConfigurationDescription}
                                </Text>
                                {applied && opensNewFolder && appliedTarget && (
                                    <Text className={classes.rowDescription}>{appliedTarget}</Text>
                                )}
                                {usedPicker && (
                                    <Text className={classes.rowDescription}>
                                        {loc.stepAddConfigurationPicker}
                                    </Text>
                                )}
                            </div>
                            {applyFailed ? (
                                <div className={classes.failureActions}>
                                    {/* The reason names paths and is not localized, so it stays
                                        in the log rather than the dialog; this is how the user
                                        reaches it. A cancelled overwrite has no reason to read. */}
                                    {!hasFileConflict && (
                                        <Button size="small" appearance="subtle" onClick={showLog}>
                                            {loc.showLog}
                                        </Button>
                                    )}
                                    <Button size="small" onClick={() => void applyTemplate()}>
                                        {locConstants.common.retry}
                                    </Button>
                                </div>
                            ) : (
                                renderStatus(configStatus)
                            )}
                        </div>

                        <Text className={classes.hint}>{loc.openInContainerHint}</Text>
                    </>
                )}
            </DialogShell>
        </Dialog>
    );
};

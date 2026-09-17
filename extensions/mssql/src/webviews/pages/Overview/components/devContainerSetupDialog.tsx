/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Link,
    Spinner,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowClockwise16Regular,
    CheckmarkCircle16Filled,
    Dismiss24Regular,
    Open16Regular,
    Warning16Filled,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { DevContainerTemplate, getTemplateSourceUrl, overviewLinks } from "../overviewContent";
import {
    DevContainerPrerequisites,
    PrerequisiteStatus,
} from "../../../../sharedInterfaces/overview";
import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    surface: {
        // Wide enough that the prerequisite rows and the action buttons stay on one line each.
        maxWidth: "620px",
        // The header and footer bands run edge to edge, so the surface owns no padding of its own.
        padding: 0,
    },
    // DialogBody is a 3-column grid with an 8px gap, which is what confined the header and footer
    // bands to a subset of the columns. Stacking the regions removes the placement entirely.
    dialogBody: {
        display: "flex",
        flexDirection: "column",
        gap: 0,
    },
    header: {
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        padding: "16px 24px",
        margin: 0,
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: "12px",
        width: "100%",
    },
    headerTitle: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: "16px 24px",
        margin: 0,
        flexGrow: 1,
        minHeight: 0,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        columnGap: "12px",
        padding: "12px 24px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
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
    learnMore: {
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: tokens.spacingHorizontalXXS,
        fontSize: "13px",
    },
});

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
        installDevContainersExtension,
        addDevContainerConfiguration,
        reopenInContainer,
    } = useOverviewActions();
    // The controller watches the folder for the configuration appearing, so this stays the single
    // source of truth for whether the scaffolding step is done.
    const hasDevContainerConfig = useOverviewSelector((state) => state.hasDevContainerConfig);
    const [page, setPage] = useState<"prerequisites" | "setUp">("prerequisites");
    const [isApplying, setIsApplying] = useState(false);
    const [applyFailed, setApplyFailed] = useState(false);
    const [usedPicker, setUsedPicker] = useState(false);
    // The request reports what it wrote, so the step does not hang on "not found" if the
    // folder-watching state lags behind.
    const [applied, setApplied] = useState(false);
    // Prerequisites are only meaningful while this dialog is open, so they stay local to it
    // rather than being pushed through the page's shared state.
    const [prerequisites, setPrerequisites] = useState<DevContainerPrerequisites>({
        docker: PrerequisiteStatus.Unknown,
        devContainersExtension: PrerequisiteStatus.Unknown,
    });

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

    const install = async () => {
        setPrerequisites((current) => ({
            ...current,
            devContainersExtension: PrerequisiteStatus.Checking,
        }));
        setPrerequisites(await installDevContainersExtension());
    };

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

    const configReady = applied || hasDevContainerConfig;

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
        setUsedPicker(false);
        try {
            const result = await addDevContainerConfiguration(template.id);
            // The request carries the CLI's own message, which is unlocalized and embeds the
            // workspace path. The controller has already logged it, so only the outcome is kept
            // here and the dialog shows a localized string.
            setApplyFailed(result.error !== undefined);
            setUsedPicker(result.usedPicker);
            setApplied(result.applied);
        } catch {
            // A rejected request (the fallback command or the RPC itself failing) would otherwise
            // leave the step with no error and no Retry button, stranding the flow.
            setApplyFailed(true);
        } finally {
            setIsApplying(false);
        }
    }, [addDevContainerConfiguration, template.id]);

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
            <DialogSurface className={classes.surface}>
                <DialogBody className={classes.dialogBody}>
                    <DialogTitle className={classes.header}>
                        <div className={classes.headerRow}>
                            <span className={classes.headerTitle}>{template.name}</span>
                            <Button
                                appearance="subtle"
                                aria-label={locConstants.common.close}
                                icon={<Dismiss24Regular />}
                                onClick={onDismiss}
                            />
                        </div>
                    </DialogTitle>
                    <DialogContent className={classes.body}>
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
                                        <Text className={classes.rowTitle}>
                                            {loc.prerequisiteDocker}
                                        </Text>
                                        <Text className={classes.rowDescription}>
                                            {loc.prerequisiteDockerDescription}
                                        </Text>
                                    </div>
                                    {prerequisites.docker === PrerequisiteStatus.Missing ? (
                                        <Button
                                            size="small"
                                            onClick={() => openLink(overviewLinks.dockerDesktop)}>
                                            {loc.installDocker}
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
                                    {prerequisites.devContainersExtension ===
                                    PrerequisiteStatus.Missing ? (
                                        <Button size="small" onClick={() => void install()}>
                                            {loc.install}
                                        </Button>
                                    ) : (
                                        renderStatus(prerequisites.devContainersExtension)
                                    )}
                                </div>
                            </>
                        )}

                        {page === "setUp" && (
                            <>
                                <SectionHeading>{loc.devContainerSetUpSteps}</SectionHeading>

                                <div className={classes.row}>
                                    <div className={classes.rowText}>
                                        <Text className={classes.rowTitle}>
                                            {loc.stepAddConfiguration}
                                        </Text>
                                        <Text className={classes.rowDescription}>
                                            {applyFailed
                                                ? loc.stepAddConfigurationFailed
                                                : loc.stepAddConfigurationDescription}
                                        </Text>
                                        {usedPicker && (
                                            <Text className={classes.rowDescription}>
                                                {loc.stepAddConfigurationPicker}
                                            </Text>
                                        )}
                                    </div>
                                    {applyFailed ? (
                                        <Button size="small" onClick={() => void applyTemplate()}>
                                            {locConstants.common.retry}
                                        </Button>
                                    ) : (
                                        renderStatus(configStatus)
                                    )}
                                </div>

                                <Text className={classes.hint}>{loc.openInContainerHint}</Text>
                            </>
                        )}

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
                    </DialogContent>
                    <DialogActions className={classes.actions}>
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
                                    disabled={!prerequisitesReady}
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
                                        reopenInContainer();
                                        onDismiss();
                                    }}>
                                    {loc.openVsCodeInContainer}
                                </Button>
                            </>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

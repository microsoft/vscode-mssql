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
import { CheckmarkCircle16Filled, Open16Regular, Warning16Filled } from "@fluentui/react-icons";
import { useEffect } from "react";

import { DevContainerTemplate, getTemplateSourceUrl } from "../overviewContent";
import { PrerequisiteStatus } from "../../../../sharedInterfaces/overview";
import { SectionHeading } from "./sectionHeading";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    surface: {
        // Wide enough that the prerequisite rows and the action buttons stay on one line each.
        maxWidth: "620px",
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
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
    learnMore: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        marginRight: "auto",
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
    } = useOverviewActions();
    const prerequisites = useOverviewSelector((state) => state.prerequisites);

    useEffect(() => {
        checkPrerequisites();
    }, [checkPrerequisites]);

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

    const canAddConfiguration =
        prerequisites.docker === PrerequisiteStatus.Ready &&
        prerequisites.devContainersExtension === PrerequisiteStatus.Ready;

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle>{template.name}</DialogTitle>
                    <DialogContent className={classes.body}>
                        <SectionHeading>{loc.prerequisites}</SectionHeading>

                        <div className={classes.row}>
                            <div className={classes.rowText}>
                                <Text className={classes.rowTitle}>{loc.prerequisiteGit}</Text>
                                <Text className={classes.rowDescription}>
                                    {loc.prerequisiteGitDescription}
                                </Text>
                            </div>
                            {renderStatus(prerequisites.git)}
                        </div>

                        <div className={classes.row}>
                            <div className={classes.rowText}>
                                <Text className={classes.rowTitle}>{loc.prerequisiteDocker}</Text>
                                <Text className={classes.rowDescription}>
                                    {loc.prerequisiteDockerDescription}
                                </Text>
                            </div>
                            {renderStatus(prerequisites.docker)}
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
                                <Button size="small" onClick={installDevContainersExtension}>
                                    {loc.install}
                                </Button>
                            ) : (
                                renderStatus(prerequisites.devContainersExtension)
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions fluid className={classes.actions}>
                        <Link
                            as="button"
                            className={classes.learnMore}
                            onClick={() => openLink(getTemplateSourceUrl(template))}>
                            {loc.learnMoreAboutTemplate}
                            <Open16Regular />
                        </Link>
                        <Button appearance="secondary" onClick={onDismiss}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!canAddConfiguration}
                            onClick={() => {
                                addDevContainerConfiguration(template.id);
                                onDismiss();
                            }}>
                            {loc.addDevContainerConfiguration}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

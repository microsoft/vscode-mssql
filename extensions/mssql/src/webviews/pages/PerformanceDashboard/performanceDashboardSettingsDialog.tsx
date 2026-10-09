/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useEffect } from "react";
import { locConstants as loc } from "../../common/locConstants";
import { PerformanceDashboardQueryStoreSettings } from "./performanceDashboardQueryStoreSettings";
import { SettingsSection } from "./performanceDashboardRoutes";

const useStyles = makeStyles({
    surface: {
        width: "min(1280px, 94vw)",
        maxWidth: "94vw",
        height: "90vh",
        maxHeight: "90vh",
        ...shorthands.padding("16px", "20px"),
    },
    // Keeps Fluent's grid, which puts the title and its close button on one row; the content row
    // takes the remaining height.
    body: {
        height: "100%",
        maxHeight: "100%",
    },
    content: {
        flexGrow: 1,
        ...shorthands.overflow("auto"),
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
});

/** The id of the element of a settings section, for scrolling to it. */
export function settingsSectionElementId(section: SettingsSection): string {
    return `performance-dashboard-settings-${section}`;
}

export interface PerformanceDashboardSettingsDialogProps {
    /** The section to scroll to when the dialog opens. */
    readonly section: SettingsSection;
    readonly onClose: () => void;
}

/** The dashboard settings, in a dialog that covers most of the page. */
export const PerformanceDashboardSettingsDialog = ({
    section,
    onClose,
}: PerformanceDashboardSettingsDialogProps) => {
    const classes = useStyles();

    useEffect(() => {
        requestAnimationFrame(() =>
            document
                .getElementById(settingsSectionElementId(section))
                ?.scrollIntoView({ block: "start" }),
        );
    }, [section]);

    return (
        <Dialog open modalType="modal" onOpenChange={(_event, data) => !data.open && onClose()}>
            <DialogSurface className={classes.surface}>
                <DialogBody className={classes.body}>
                    <DialogTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label={loc.common.close}
                                icon={<Dismiss24Regular />}
                                onClick={onClose}
                            />
                        }>
                        {loc.performanceDashboard.settings}
                    </DialogTitle>
                    <DialogContent className={classes.content}>
                        <section id={settingsSectionElementId("queryStore")}>
                            <PerformanceDashboardQueryStoreSettings />
                        </section>
                    </DialogContent>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

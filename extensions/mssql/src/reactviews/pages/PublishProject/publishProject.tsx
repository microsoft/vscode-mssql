/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "./publishProjectStateProvider";
import { PublishTarget } from "../../../sharedInterfaces/publishDialog";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";
import { DialogMessage } from "../../common/dialogMessage";
import { SqlCmdVariablesSection } from "./components/sqlCmdVariablesSection";
import { SqlPackageCommandSection } from "./components/sqlPackageCommandSection";
import { AdvancedDeploymentOptionsDrawer } from "./components/advancedDeploymentOptionsDrawer";
import { DialogPageShell } from "../../common/dialogPageShell";

const publishProjectIconLight = require("../../../../media/PublishProjectHeader_light.svg");
const publishProjectIconDark = require("../../../../media/PublishProjectHeader_dark.svg");

const useStyles = makeStyles({
    formContent: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: "10px",
    },
    advancedButton: {
        width: "150px",
    },
    footerButtons: {
        display: "flex",
        gap: "10px",
    },
    rightButton: {
        width: "150px",
    },
});

function PublishProjectDialog() {
    const styles = useStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    // Select pieces of state needed for this component
    const formState = usePublishDialogSelector((s) => s.formState);
    const inProgress = usePublishDialogSelector((s) => s.inProgress);
    const hasFormErrors = usePublishDialogSelector((s) => s.hasFormErrors);
    const formMessage = usePublishDialogSelector((s) => s.formMessage);
    const projectName = usePublishDialogSelector((s) => s.projectProperties?.projectName) ?? "";

    // Check if component is properly initialized and ready for user interaction
    const isComponentReady = !!context && !!formState;

    // Disabled criteria: disable when not ready, in progress, or has form errors
    const readyToPublish = !isComponentReady || inProgress || hasFormErrors;

    if (!isComponentReady) {
        return <div>Loading...</div>;
    }

    const publishProjectHeaderIcon =
        context.themeKind === ColorThemeKind.Light
            ? publishProjectIconLight
            : publishProjectIconDark;

    return (
        <>
            <DialogPageShell
                icon={<img src={publishProjectHeaderIcon} alt={loc.publishProject} />}
                title={loc.publishProjectTitle(projectName)}
                maxContentWidth="medium"
                footerStart={
                    <Button
                        appearance="secondary"
                        className={styles.advancedButton}
                        onClick={() => setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen)}>
                        {loc.advancedOptions}
                    </Button>
                }
                footerEnd={
                    <div className={styles.footerButtons}>
                        <Button
                            appearance="secondary"
                            className={styles.rightButton}
                            disabled={
                                readyToPublish ||
                                formState?.publishTarget !== PublishTarget.ExistingServer
                            }
                            onClick={() => context.generatePublishScript()}>
                            {loc.generateScript}
                        </Button>
                        <Button
                            appearance="primary"
                            className={styles.rightButton}
                            disabled={readyToPublish}
                            onClick={() => context.publishNow()}>
                            {loc.publish}
                        </Button>
                    </div>
                }>
                <form className={styles.formContent} onSubmit={(e) => e.preventDefault()}>
                    {formMessage && (
                        <DialogMessage
                            message={formMessage}
                            onMessageButtonClicked={() => {}}
                            onCloseMessage={context.closeMessage}
                        />
                    )}
                    <PublishTargetSection />
                    <PublishProfileField />
                    <ConnectionSection />
                    <SqlCmdVariablesSection />
                    <SqlPackageCommandSection />
                </form>
            </DialogPageShell>

            <AdvancedDeploymentOptionsDrawer
                isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
            />
        </>
    );
}

export default function PublishProjectPage() {
    return <PublishProjectDialog />;
}

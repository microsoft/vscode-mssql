/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectContext } from "./publishProjectStateProvider";
import { PublishTarget } from "../../../sharedInterfaces/publishDialog";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";
import { DialogMessage } from "../../common/dialogMessage";

const useStyles = makeStyles({
    root: { padding: "12px" },
    footer: {
        marginTop: "8px",
        display: "flex",
        justifyContent: "flex-end",
        gap: "12px",
        alignItems: "center",
        maxWidth: "640px",
        width: "100%",
        paddingTop: "12px",
        borderTop: "1px solid transparent",
    },
});

function PublishProjectDialog() {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext);

    // Select pieces of state needed for this component
    const formState = usePublishDialogSelector((s) => s.formState);
    const inProgress = usePublishDialogSelector((s) => s.inProgress);
    const hasFormErrors = usePublishDialogSelector((s) => s.hasFormErrors);
    const formMessage = usePublishDialogSelector((s) => s.formMessage);

    // Check if component is properly initialized and ready for user interaction
    const isComponentReady = !!context && !!formState;

    // Disabled criteria: disable when not ready, in progress, or has form errors
    const readyToPublish = !isComponentReady || inProgress || hasFormErrors;

    if (!isComponentReady) {
        return <div className={classes.root}>Loading...</div>;
    }
    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
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

                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            disabled={
                                readyToPublish ||
                                formState?.publishTarget !== PublishTarget.ExistingServer
                            }
                            onClick={() => context.generatePublishScript()}>
                            {loc.generateScript}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={readyToPublish}
                            onClick={() => context.publishNow()}>
                            {loc.publish}
                        </Button>
                    </div>
                </div>
            </div>
        </form>
    );
}

export default function PublishProjectPage() {
    return <PublishProjectDialog />;
}

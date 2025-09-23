/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectStateProvider, PublishProjectContext } from "./publishProjectStateProvider";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
} from "../../../sharedInterfaces/publishDialog";
import { FormContextProps } from "../../../sharedInterfaces/form";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";

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

type PublishFormContext = FormContextProps<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec
> & {
    publishNow: () => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
};

// Type guard to check if context has the required publish methods
function isPublishFormContext(context: unknown): context is PublishFormContext {
    if (!context || typeof context !== "object") {
        return false;
    }

    const ctx = context as Record<string, unknown>;
    return (
        "publishNow" in ctx &&
        "generatePublishScript" in ctx &&
        "selectPublishProfile" in ctx &&
        "savePublishProfile" in ctx &&
        typeof ctx.publishNow === "function" &&
        typeof ctx.generatePublishScript === "function" &&
        typeof ctx.selectPublishProfile === "function" &&
        typeof ctx.savePublishProfile === "function"
    );
}

function PublishProjectDialog() {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext);

    // Select pieces of state needed for this component
    const formComponents = usePublishDialogSelector((s) => s.formComponents, Object.is);
    const formState = usePublishDialogSelector((s) => s.formState, Object.is);
    const inProgress = usePublishDialogSelector((s) => s.inProgress, Object.is);

    // Check if component is properly initialized and ready for user interaction
    const isComponentReady = isPublishFormContext(context) && !!formComponents && !!formState;

    // Check if all required fields are provided based on publish target
    const isFormValid =
        isComponentReady &&
        (() => {
            // Always require publish target and database name
            if (!formState.publishTarget || !formState.databaseName) {
                return false;
            }

            // For existing server, require server name
            if (formState.publishTarget === "existingServer") {
                return !!formState.serverName;
            }

            // For local container, server name is not required
            if (formState.publishTarget === "localContainer") {
                return true; // Could add container-specific validations here if needed
            }

            return false;
        })();

    // Buttons should be disabled when:
    // - Component is not ready (missing context, form components, or form state)
    // - Operation is in progress
    // - Form validation fails
    const buttonsDisabled = !isComponentReady || inProgress || !isFormValid;

    if (!isComponentReady) {
        return <div className={classes.root}>Loading...</div>;
    }

    // Static ordering now expressed via explicit section components.

    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    <PublishTargetSection idx={0} />
                    <PublishProfileField idx={1} />
                    <ConnectionSection startIdx={2} />

                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            disabled={buttonsDisabled}
                            onClick={() => context.generatePublishScript()}>
                            {loc.generateScript}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={buttonsDisabled}
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
    return (
        <PublishProjectStateProvider>
            <PublishProjectDialog />
        </PublishProjectStateProvider>
    );
}

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
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";
import { validatePublishForm } from "../../../publishProject/projectUtils";
import { PublishFormContext } from "./types";
import * as constants from "../../../constants/constants";

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
    const formState = usePublishDialogSelector((s) => s.formState, Object.is);
    const inProgress = usePublishDialogSelector((s) => s.inProgress, Object.is);
    const hasFormComponents = usePublishDialogSelector((s) => !!s.formComponents, Object.is);

    const loading = !isPublishFormContext(context) || !hasFormComponents || !formState;

    // Check if all required fields are provided based on publish target
    const isFormValid = !loading && validatePublishForm(formState);

    // Buttons should be disabled when loading, in progress, or form is invalid
    const buttonsDisabled = loading || inProgress || !isFormValid;

    // Generate script should only be available for existing server target
    const generateScriptDisabled =
        buttonsDisabled || formState?.publishTarget !== constants.PublishTargets.EXISTING_SERVER;

    if (loading) {
        return <div className={classes.root}>Loading...</div>;
    }

    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    <PublishTargetSection idx={0} />
                    <PublishProfileField idx={1} />
                    <ConnectionSection idx={2} />

                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            disabled={generateScriptDisabled}
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

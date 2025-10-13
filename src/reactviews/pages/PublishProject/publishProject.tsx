/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectContext } from "./publishProjectStateProvider";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
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
    const isComponentReady = !!context && !!formComponents && !!formState;

    // Let the form framework handle validation - check if any visible components have validation errors
    const hasValidationErrors =
        isComponentReady && formComponents
            ? Object.values(formComponents).some(
                  (component) =>
                      !component.hidden && component.validation && !component.validation.isValid,
              )
            : false;

    // Buttons should be disabled when:
    // - Component is not ready (missing context, form components, or form state)
    // - Operation is in progress
    // - Form has validation errors
    const readyToPublish = !isComponentReady || inProgress || hasValidationErrors;

    if (!isComponentReady) {
        return <div className={classes.root}>Loading...</div>;
    }

    // Static ordering now expressed via explicit section components.
    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    <PublishTargetSection />
                    <PublishProfileField />
                    <ConnectionSection />

                    <div className={classes.footer}>
                        <Button
                            appearance="secondary"
                            disabled={readyToPublish}
                            onClick={() => context!.generatePublishScript()}>
                            {loc.generateScript}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={readyToPublish}
                            onClick={() => context!.publishNow()}>
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

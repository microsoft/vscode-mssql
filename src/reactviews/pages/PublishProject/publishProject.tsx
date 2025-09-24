/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectStateProvider, PublishProjectContext } from "./publishProjectStateProvider";
import { IPublishForm } from "../../../sharedInterfaces/publishDialog";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";
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

function PublishProjectDialog() {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext);

    // Select pieces of state needed for this component
    const formComponents = usePublishDialogSelector((s) => s.formComponents, Object.is);
    const formState = usePublishDialogSelector((s) => s.formState, Object.is);
    const inProgress = usePublishDialogSelector((s) => s.inProgress, Object.is);
    console.debug();
    // Check if component is properly initialized and ready for user interaction
    const isComponentReady = !!context && !!formComponents && !!formState;

    // Check if any visible component has an explicit validation error.
    // NOTE: Relying solely on component.validation misses the case where a required field is still untouched
    // and thus has no validation state yet. We therefore also perform a required-value presence check below.
    const hasValidationErrors =
        isComponentReady && formComponents
            ? Object.values(formComponents).some(
                  (component) =>
                      !component.hidden &&
                      component.validation !== undefined &&
                      component.validation.isValid === false,
              )
            : false;

    // Identify missing required values for visible components (treat empty string / whitespace as missing)
    const hasMissingRequiredValues =
        isComponentReady && formComponents && formState
            ? Object.values(formComponents).some((component) => {
                  if (component.hidden || !component.required) {
                      return false;
                  }
                  const key = component.propertyName as keyof IPublishForm;
                  const raw = formState[key];
                  if (raw === undefined) {
                      return true;
                  }
                  return typeof raw === "string" && raw.trim().length === 0;
              })
            : true; // if not ready, treat as missing

    // Disabled criteria (previously inverted): disable when not ready, in progress, validation errors, or missing required fields
    const readyToPublish =
        !isComponentReady || inProgress || hasValidationErrors || hasMissingRequiredValues;

    // Generate script only for existing server target
    const readyToGenerateScript =
        readyToPublish || formState?.publishTarget !== constants.PublishTargets.EXISTING_SERVER;

    if (!isComponentReady) {
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
                            disabled={readyToGenerateScript}
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
    return (
        <PublishProjectStateProvider>
            <PublishProjectDialog />
        </PublishProjectStateProvider>
    );
}

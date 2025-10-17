/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { PublishProjectContext } from "./publishProjectStateProvider";
import { IPublishForm, PublishTarget } from "../../../sharedInterfaces/publishDialog";
import { usePublishDialogSelector } from "./publishDialogSelector";
import { LocConstants } from "../../common/locConstants";
import { PublishProfileField } from "./components/PublishProfileSection";
import { PublishTargetSection } from "./components/PublishTargetSection";
import { ConnectionSection } from "./components/ConnectionSection";
import { AdvancedDeploymentOptionsDrawer } from "./components/advancedDeploymentOptionsDrawer";

const useStyles = makeStyles({
    root: { padding: "12px" },
    rightButton: {
        width: "150px",
        marginLeft: "10px",
        marginRight: "0px",
    },
});

function PublishProjectDialog() {
    const classes = useStyles();
    const formStyles = useFormStyles();
    const loc = LocConstants.getInstance().publishProject;
    const context = useContext(PublishProjectContext);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

    // Select pieces of state needed for this component
    const formComponents = usePublishDialogSelector((s) => s.formComponents);
    const formState = usePublishDialogSelector((s) => s.formState);
    const inProgress = usePublishDialogSelector((s) => s.inProgress);
    // Check if component is properly initialized and ready for user interaction
    const isComponentReady = !!context && !!formComponents && !!formState;

    // Check if any visible component has an explicit validation error.
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
                  // Missing if undefined/null
                  if (raw === undefined) {
                      return true;
                  }
                  // For strings, empty/whitespace is missing
                  if (typeof raw === "string") {
                      return raw.trim().length === 0;
                  }
                  // For booleans (e.g. required checkbox), must be true
                  if (typeof raw === "boolean") {
                      return raw !== true;
                  }
                  // For numbers, allow 0 (not missing) - adjust if a field ever requires >0
                  return false;
              })
            : true; // if not ready, treat as missing

    // Disabled criteria: disable when not ready, in progress, validation errors, or missing required fields
    const readyToPublish =
        !isComponentReady || inProgress || hasValidationErrors || hasMissingRequiredValues;

    if (!isComponentReady) {
        return <div className={classes.root}>Loading...</div>;
    }
    return (
        <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
            <div className={classes.root}>
                <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
                    <PublishTargetSection />
                    <PublishProfileField />
                    <ConnectionSection />

                    <div className={formStyles.formNavTray}>
                        <Button
                            appearance="secondary"
                            className={formStyles.formNavTrayButton}
                            onClick={() => setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen)}>
                            {loc.advancedOptions}
                        </Button>
                        <div className={formStyles.formNavTrayRight}>
                            <Button
                                appearance="secondary"
                                className={classes.rightButton}
                                disabled={
                                    readyToPublish ||
                                    formState?.publishTarget !== PublishTarget.ExistingServer
                                }
                                onClick={() => context.generatePublishScript()}>
                                {loc.generateScript}
                            </Button>
                            <Button
                                appearance="primary"
                                className={classes.rightButton}
                                disabled={readyToPublish}
                                onClick={() => context.publishNow()}>
                                {loc.publish}
                            </Button>
                        </div>
                    </div>
                </div>

                <AdvancedDeploymentOptionsDrawer
                    isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                    setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                />
            </div>
        </form>
    );
}

export default function PublishProjectPage() {
    return <PublishProjectDialog />;
}

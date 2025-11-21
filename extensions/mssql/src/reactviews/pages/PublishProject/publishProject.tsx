/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
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
import { SqlCmdVariablesSection } from "./components/sqlCmdVariablesSection";
import { AdvancedDeploymentOptionsDrawer } from "./components/advancedDeploymentOptionsDrawer";

const useStyles = makeStyles({
  rightButton: {
    width: "150px",
    marginLeft: "10px",
    marginRight: "0px",
  },
});

function PublishProjectDialog() {
  const styles = useStyles();
  const formStyles = useFormStyles();
  const loc = LocConstants.getInstance().publishProject;
  const context = useContext(PublishProjectContext);
  const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

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
    return <div>Loading...</div>;
  }
  return (
    <form className={formStyles.formRoot} onSubmit={(e) => e.preventDefault()}>
      <div className={formStyles.formDiv} style={{ overflow: "auto" }}>
        {formMessage && (
          <div>
            <DialogMessage
              message={formMessage}
              onMessageButtonClicked={() => {}}
              onCloseMessage={context.closeMessage}
            />
          </div>
        )}
        <PublishTargetSection />
        <PublishProfileField />
        <ConnectionSection />
        <SqlCmdVariablesSection />

        <div className={formStyles.formNavTray}>
          <Button
            appearance="secondary"
            className={formStyles.formNavTrayButton}
            onClick={() => setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen)}
          >
            {loc.advancedOptions}
          </Button>
          <div className={formStyles.formNavTrayRight}>
            <Button
              appearance="secondary"
              className={styles.rightButton}
              disabled={
                readyToPublish ||
                formState?.publishTarget !== PublishTarget.ExistingServer
              }
              onClick={() => context.generatePublishScript()}
            >
              {loc.generateScript}
            </Button>
            <Button
              appearance="primary"
              className={styles.rightButton}
              disabled={readyToPublish}
              onClick={() => context.publishNow()}
            >
              {loc.publish}
            </Button>
          </div>
        </div>
      </div>

      <AdvancedDeploymentOptionsDrawer
        isAdvancedDrawerOpen={isAdvancedDrawerOpen}
        setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
      />
    </form>
  );
}

export default function PublishProjectPage() {
  return <PublishProjectDialog />;
}

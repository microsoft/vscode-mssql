/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useRef, useEffect } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  MessageBar,
} from "@fluentui/react-components";

import { locConstants } from "../../../common/locConstants";
import { connectionCertValidationReadMoreUrl } from "../connectionConstants";
import { TrustServerCertDialogProps } from "../../../../sharedInterfaces/connectionDialog";

export const TrustServerCertificateDialog = ({
  dialogProps,
}: {
  dialogProps: TrustServerCertDialogProps;
}) => {
  const context = useContext(ConnectionDialogContext)!;
  // eslint-disable-next-line no-restricted-syntax -- Ref needs to be null, not undefined
  const trustCertButtonRef = useRef<HTMLButtonElement | null>(null);

  if (context.state.dialog?.type !== "trustServerCert") {
    return undefined;
  }

  useEffect(() => {
    // Focus the "Trust Server Certificate" button when the dialog opens
    if (trustCertButtonRef.current) {
      trustCertButtonRef.current.focus();
    }
  }, []);

  const handleCancel = () => {
    context.closeDialog();
  };

  return (
    <Dialog open={dialogProps.type === "trustServerCert"}>
      <DialogSurface
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Escape") {
            handleCancel();
          }
        }}
      >
        <DialogBody>
          <DialogTitle>
            {locConstants.connectionDialog.connectionErrorTitle}
          </DialogTitle>
          <DialogContent>
            <MessageBar intent="error" style={{ paddingRight: "12px" }}>
              {dialogProps.message}
            </MessageBar>
            <br />
            {locConstants.connectionDialog.trustServerCertMessage}
            <br />
            <br />
            {locConstants.connectionDialog.trustServerCertPrompt}
            {" " /* extra space before the 'Read More' link*/}
            <Link href={connectionCertValidationReadMoreUrl}>
              {locConstants.connectionDialog.readMore}
            </Link>
          </DialogContent>
          <DialogActions>
            <Button
              ref={trustCertButtonRef}
              appearance="primary"
              style={{ width: "auto", whiteSpace: "nowrap" }}
              onClick={() => {
                context.closeDialog();
                context.formAction({
                  propertyName: "trustServerCertificate",
                  value: true,
                  isAction: false,
                });
                context.connect();
              }}
            >
              {locConstants.connectionDialog.enableTrustServerCertificateButton}
            </Button>
            <Button appearance="secondary" onClick={handleCancel}>
              {locConstants.common.cancel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

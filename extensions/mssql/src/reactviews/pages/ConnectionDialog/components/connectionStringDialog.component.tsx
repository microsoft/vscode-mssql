/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect, useRef } from "react";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Textarea,
  MessageBar,
} from "@fluentui/react-components";
import { Copy24Regular, ClipboardPaste24Regular } from "@fluentui/react-icons";

import { locConstants } from "../../../common/locConstants";
import { ConnectionStringDialogProps } from "../../../../sharedInterfaces/connectionDialog";

export const ConnectionStringDialog = ({
  dialogProps,
}: {
  dialogProps: ConnectionStringDialogProps;
}) => {
  const context = useContext(ConnectionDialogContext)!;
  const [connectionString, setConnectionString] = useState(
    dialogProps.connectionString || "",
  );
  // eslint-disable-next-line no-restricted-syntax -- Ref needs to be null, not undefined
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Automatically focus the textarea when the dialog opens
  useEffect(() => {
    if (textareaRef.current) {
      // Small delay to ensure the dialog is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, []);

  if (context.state.dialog?.type !== "loadFromConnectionString") {
    return undefined;
  }

  const handleCopyConnectionString = async () => {
    try {
      await navigator.clipboard.writeText(connectionString);
    } catch (error) {
      console.error("Failed to copy connection string: ", error);
    }
  };

  const handlePasteConnectionString = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setConnectionString(text);
    } catch (error) {
      console.error("Failed to paste connection string: ", error);
    }
  };

  return (
    <Dialog open={dialogProps.type === "loadFromConnectionString"}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {locConstants.connectionDialog.loadFromConnectionString}
            </span>
            <div style={{ display: "flex", gap: "5px" }}>
              <Button
                appearance="transparent"
                size="small"
                icon={<Copy24Regular />}
                onClick={handleCopyConnectionString}
                title={locConstants.connectionDialog.copyConnectionString}
              />
              <Button
                appearance="transparent"
                size="small"
                icon={<ClipboardPaste24Regular />}
                onClick={handlePasteConnectionString}
                title={locConstants.connectionDialog.pasteConnectionString}
              />
            </div>
          </DialogTitle>
          <DialogContent>
            {dialogProps.connectionStringError && (
              <>
                <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                  {dialogProps.connectionStringError}
                </MessageBar>
                <br />
              </>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: "10px",
              }}
            >
              {" "}
              <Textarea
                ref={textareaRef}
                value={connectionString}
                onChange={(_e, data) => setConnectionString(data.value)}
                resize="none"
                style={{
                  height: "200px",
                }}
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => {
                context.loadFromConnectionString(connectionString);
              }}
            >
              {locConstants.common.load}
            </Button>
            <Button
              appearance="secondary"
              onClick={() => {
                context.closeDialog();
              }}
            >
              {locConstants.common.cancel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

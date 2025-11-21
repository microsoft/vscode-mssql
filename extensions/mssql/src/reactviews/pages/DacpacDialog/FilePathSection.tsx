/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Field, Input, makeStyles } from "@fluentui/react-components";
import { FolderOpen20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";

/**
 * Validation message with severity level
 */
interface ValidationMessage {
  message: string;
  severity: "error" | "warning";
}

interface FilePathSectionProps {
  filePath: string;
  setFilePath: (value: string) => void;
  requiresInputFile: boolean;
  isOperationInProgress: boolean;
  validationMessages: Record<string, ValidationMessage>;
  onBrowseFile: () => void;
  onFilePathChange: (value: string) => void;
}

const useStyles = makeStyles({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  fileInputGroup: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
  },
  fileInput: {
    flexGrow: 1,
  },
});

export const FilePathSection = ({
  filePath,
  requiresInputFile,
  isOperationInProgress,
  validationMessages,
  onBrowseFile,
  onFilePathChange,
}: FilePathSectionProps) => {
  const classes = useStyles();

  return (
    <div className={classes.section}>
      <Field
        label={
          requiresInputFile
            ? locConstants.dacpacDialog.packageFileLabel
            : locConstants.dacpacDialog.outputFileLabel
        }
        required
        validationMessage={validationMessages.filePath?.message}
        validationState={
          validationMessages.filePath
            ? validationMessages.filePath.severity === "error"
              ? "error"
              : "warning"
            : "none"
        }
      >
        <div className={classes.fileInputGroup}>
          <Input
            className={classes.fileInput}
            value={filePath}
            onChange={(_, data) => onFilePathChange(data.value)}
            placeholder={
              requiresInputFile
                ? locConstants.dacpacDialog.selectPackageFile
                : locConstants.dacpacDialog.selectOutputFile
            }
            disabled={isOperationInProgress}
            aria-label={
              requiresInputFile
                ? locConstants.dacpacDialog.packageFileLabel
                : locConstants.dacpacDialog.outputFileLabel
            }
          />
          <Button
            icon={<FolderOpen20Regular />}
            appearance="secondary"
            onClick={onBrowseFile}
            disabled={isOperationInProgress}
            aria-label={locConstants.dacpacDialog.browse}
          >
            {locConstants.dacpacDialog.browse}
          </Button>
        </div>
      </Field>
    </div>
  );
};

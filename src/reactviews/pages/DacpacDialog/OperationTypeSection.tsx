/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, makeStyles, Radio, RadioGroup } from "@fluentui/react-components";
import { DacFxOperationType } from "../../../sharedInterfaces/dacpacDialog";
import { locConstants } from "../../common/locConstants";

interface OperationTypeSectionProps {
    operationType: DacFxOperationType;
    setOperationType: (value: DacFxOperationType) => void;
    isOperationInProgress: boolean;
    onOperationTypeChange?: () => void;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

export const OperationTypeSection = ({
    operationType,
    setOperationType,
    isOperationInProgress,
    onOperationTypeChange,
}: OperationTypeSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Field label={locConstants.dacpacDialog.operationLabel} required>
                <RadioGroup
                    value={operationType}
                    onChange={(_, data) => {
                        setOperationType(data.value as DacFxOperationType);
                        onOperationTypeChange?.();
                    }}
                    disabled={isOperationInProgress}
                    aria-label={locConstants.dacpacDialog.operationLabel}>
                    <Radio
                        value={DacFxOperationType.Deploy}
                        label={
                            locConstants.dacpacDialog.deployDescription +
                            " (" +
                            locConstants.dacpacDialog.deployDacpac +
                            ")"
                        }
                        aria-label={locConstants.dacpacDialog.deployDacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Extract}
                        label={
                            locConstants.dacpacDialog.extractDescription +
                            " (" +
                            locConstants.dacpacDialog.extractDacpac +
                            ")"
                        }
                        aria-label={locConstants.dacpacDialog.extractDacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Import}
                        label={
                            locConstants.dacpacDialog.importDescription +
                            " (" +
                            locConstants.dacpacDialog.importBacpac +
                            ")"
                        }
                        aria-label={locConstants.dacpacDialog.importBacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Export}
                        label={
                            locConstants.dacpacDialog.exportDescription +
                            " (" +
                            locConstants.dacpacDialog.exportBacpac +
                            ")"
                        }
                        aria-label={locConstants.dacpacDialog.exportBacpac}
                    />
                </RadioGroup>
            </Field>
        </div>
    );
};

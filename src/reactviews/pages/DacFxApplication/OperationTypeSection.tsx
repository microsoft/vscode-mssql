/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, makeStyles, Radio, RadioGroup } from "@fluentui/react-components";
import { DacFxOperationType } from "../../../sharedInterfaces/dacFxApplication";
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
            <Field label={locConstants.dacFxApplication.operationLabel} required>
                <RadioGroup
                    value={operationType}
                    onChange={(_, data) => {
                        setOperationType(data.value as DacFxOperationType);
                        onOperationTypeChange?.();
                    }}
                    disabled={isOperationInProgress}
                    aria-label={locConstants.dacFxApplication.operationLabel}>
                    <Radio
                        value={DacFxOperationType.Deploy}
                        label={
                            locConstants.dacFxApplication.deployDescription +
                            " (" +
                            locConstants.dacFxApplication.deployDacpac +
                            ")"
                        }
                        aria-label={locConstants.dacFxApplication.deployDacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Extract}
                        label={
                            locConstants.dacFxApplication.extractDescription +
                            " (" +
                            locConstants.dacFxApplication.extractDacpac +
                            ")"
                        }
                        aria-label={locConstants.dacFxApplication.extractDacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Import}
                        label={
                            locConstants.dacFxApplication.importDescription +
                            " (" +
                            locConstants.dacFxApplication.importBacpac +
                            ")"
                        }
                        aria-label={locConstants.dacFxApplication.importBacpac}
                    />
                    <Radio
                        value={DacFxOperationType.Export}
                        label={
                            locConstants.dacFxApplication.exportDescription +
                            " (" +
                            locConstants.dacFxApplication.exportBacpac +
                            ")"
                        }
                        aria-label={locConstants.dacFxApplication.exportBacpac}
                    />
                </RadioGroup>
            </Field>
        </div>
    );
};

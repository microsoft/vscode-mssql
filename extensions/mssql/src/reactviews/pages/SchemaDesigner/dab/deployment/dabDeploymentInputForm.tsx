/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    Field,
    Input,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    fieldHint: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginTop: "2px",
    },
});

interface DabDeploymentInputFormProps {
    initialParams: Dab.DabDeploymentParams;
    onSubmit: (params: Dab.DabDeploymentParams) => void;
    onBack: () => void;
}

export const DabDeploymentInputForm = ({
    initialParams,
    onSubmit,
    onBack,
}: DabDeploymentInputFormProps) => {
    const classes = useStyles();

    const [containerName, setContainerName] = useState(initialParams.containerName);
    const [port, setPort] = useState(initialParams.port.toString());
    const [containerNameError, setContainerNameError] = useState<string | undefined>();
    const [portError, setPortError] = useState<string | undefined>();

    const validateForm = (): boolean => {
        let isValid = true;

        // Validate container name
        if (!containerName.trim()) {
            setContainerNameError("Container name is required");
            isValid = false;
        } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
            setContainerNameError(
                "Must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen",
            );
            isValid = false;
        } else {
            setContainerNameError(undefined);
        }

        // Validate port
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            setPortError("Port must be between 1 and 65535");
            isValid = false;
        } else {
            setPortError(undefined);
        }

        return isValid;
    };

    const handleSubmit = () => {
        if (!validateForm()) {
            return;
        }
        onSubmit({
            containerName,
            port: parseInt(port, 10),
        });
    };

    return (
        <>
            <DialogTitle>Container Settings</DialogTitle>
            <DialogContent className={classes.content}>
                <Field
                    label="Container Name"
                    validationState={containerNameError ? "error" : undefined}
                    validationMessage={containerNameError}>
                    <Input
                        value={containerName}
                        onChange={(_, data) => setContainerName(data.value)}
                    />
                    <Text className={classes.fieldHint}>
                        Name for the Docker container running DAB
                    </Text>
                </Field>

                <Field
                    label="Port"
                    validationState={portError ? "error" : undefined}
                    validationMessage={portError}>
                    <Input type="number" value={port} onChange={(_, data) => setPort(data.value)} />
                    <Text className={classes.fieldHint}>
                        Port to expose the API on (default: 5000)
                    </Text>
                </Field>
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onBack}>
                    {locConstants.common.back}
                </Button>
                <Button appearance="primary" onClick={handleSubmit}>
                    {locConstants.localContainers.createContainer}
                </Button>
            </DialogActions>
        </>
    );
};

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
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
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
    validateParams: (
        containerName: string,
        port: number,
    ) => Promise<Dab.ValidateDeploymentParamsResponse>;
    onSubmit: (params: Dab.DabDeploymentParams) => void;
    onCancel: () => void;
}

export const DabDeploymentInputForm = ({
    initialParams,
    validateParams,
    onSubmit,
    onCancel,
}: DabDeploymentInputFormProps) => {
    const classes = useStyles();

    const [containerName, setContainerName] = useState(initialParams.containerName);
    const [port, setPort] = useState(initialParams.port.toString());
    const [containerNameError, setContainerNameError] = useState<string | undefined>();
    const [portError, setPortError] = useState<string | undefined>();
    const [isValidating, setIsValidating] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    // Auto-generate validated defaults on mount
    useEffect(() => {
        const initializeDefaults = async () => {
            setIsInitializing(true);
            try {
                // Pass empty string to trigger auto-generation of unique container name
                const result = await validateParams("", initialParams.port);
                // Use validated/suggested values
                setContainerName(result.validatedContainerName);
                setPort(result.suggestedPort.toString());
            } finally {
                setIsInitializing(false);
            }
        };
        void initializeDefaults();
    }, []); // Component remounts each time dialog opens, so empty deps is correct

    const validateFormClient = (): boolean => {
        let isValid = true;

        // Validate container name (client-side)
        if (!containerName.trim()) {
            setContainerNameError(locConstants.schemaDesigner.containerNameRequired);
            isValid = false;
        } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
            setContainerNameError(locConstants.schemaDesigner.containerNameInvalid);
            isValid = false;
        } else {
            setContainerNameError(undefined);
        }

        // Validate port (client-side)
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            setPortError(locConstants.schemaDesigner.portInvalid);
            isValid = false;
        } else {
            setPortError(undefined);
        }

        return isValid;
    };

    const handleSubmit = async () => {
        // First do client-side validation
        if (!validateFormClient()) {
            return;
        }

        // Then do server-side validation
        setIsValidating(true);
        try {
            const portNum = parseInt(port, 10);
            const result = await validateParams(containerName, portNum);

            if (!result.isContainerNameValid) {
                setContainerNameError(result.containerNameError);
            }
            if (!result.isPortValid) {
                setPortError(result.portError);
            }

            if (result.isContainerNameValid && result.isPortValid) {
                onSubmit({
                    containerName,
                    port: portNum,
                });
            }
        } finally {
            setIsValidating(false);
        }
    };

    const isLoading = isInitializing || isValidating;

    return (
        <>
            <DialogTitle>{locConstants.schemaDesigner.containerSettings}</DialogTitle>
            <DialogContent className={classes.content}>
                <Field
                    label={locConstants.schemaDesigner.containerName}
                    validationState={containerNameError ? "error" : undefined}
                    validationMessage={containerNameError}>
                    <Input
                        value={containerName}
                        onChange={(_, data) => setContainerName(data.value)}
                        disabled={isLoading}
                    />
                    <Text className={classes.fieldHint}>
                        {locConstants.schemaDesigner.containerNameHint}
                    </Text>
                </Field>

                <Field
                    label={locConstants.schemaDesigner.port}
                    validationState={portError ? "error" : undefined}
                    validationMessage={portError}>
                    <Input
                        type="number"
                        value={port}
                        onChange={(_, data) => setPort(data.value)}
                        disabled={isLoading}
                    />
                    <Text className={classes.fieldHint}>
                        {locConstants.schemaDesigner.portHint}
                    </Text>
                </Field>
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onCancel} disabled={isValidating}>
                    {locConstants.common.cancel}
                </Button>
                <Button
                    appearance="primary"
                    onClick={handleSubmit}
                    disabled={isLoading}
                    icon={isValidating ? <Spinner size="tiny" /> : undefined}>
                    {locConstants.localContainers.createContainer}
                </Button>
            </DialogActions>
        </>
    );
};

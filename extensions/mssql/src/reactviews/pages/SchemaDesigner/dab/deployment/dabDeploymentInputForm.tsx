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
import { useCallback, useEffect, useRef, useState } from "react";
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
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    const validationRequestRef = useRef(0);

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

    const validateClientSide = useCallback(
        (name: string, portStr: string): { nameError?: string; portError?: string } => {
            let nameError: string | undefined;
            let portError: string | undefined;

            if (!name.trim()) {
                nameError = locConstants.schemaDesigner.containerNameRequired;
            } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
                nameError = locConstants.schemaDesigner.containerNameInvalid;
            }

            const portNum = parseInt(portStr, 10);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                portError = locConstants.schemaDesigner.portInvalid;
            }

            return { nameError, portError };
        },
        [],
    );

    // Debounced validation on input change
    useEffect(() => {
        if (isInitializing) {
            return;
        }

        // Immediate client-side validation
        const { nameError, portError } = validateClientSide(containerName, port);
        setContainerNameError(nameError);
        setPortError(portError);

        // Skip server-side if client-side fails
        if (nameError || portError) {
            return;
        }

        const requestId = ++validationRequestRef.current;
        const timeout = setTimeout(() => {
            const portNum = parseInt(port, 10);
            void validateParams(containerName, portNum).then((result) => {
                // Only apply if this is still the latest request
                if (requestId !== validationRequestRef.current) {
                    return;
                }
                setContainerNameError(
                    result.isContainerNameValid ? undefined : result.containerNameError,
                );
                setPortError(result.isPortValid ? undefined : result.portError);
            });
        }, 300);

        return () => clearTimeout(timeout);
    }, [containerName, port, isInitializing, validateParams, validateClientSide]);

    const handleSubmit = async () => {
        const { nameError, portError } = validateClientSide(containerName, port);
        if (nameError || portError) {
            setContainerNameError(nameError);
            setPortError(portError);
            return;
        }

        setIsSubmitting(true);
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
            setIsSubmitting(false);
        }
    };

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
                        disabled={isInitializing}
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
                        disabled={isInitializing}
                    />
                    <Text className={classes.fieldHint}>
                        {locConstants.schemaDesigner.portHint}
                    </Text>
                </Field>
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onCancel} disabled={isSubmitting}>
                    {locConstants.common.cancel}
                </Button>
                <Button
                    appearance="primary"
                    onClick={handleSubmit}
                    disabled={isInitializing || isSubmitting}
                    icon={isSubmitting ? <Spinner size="tiny" /> : undefined}>
                    {locConstants.localContainers.createContainer}
                </Button>
            </DialogActions>
        </>
    );
};

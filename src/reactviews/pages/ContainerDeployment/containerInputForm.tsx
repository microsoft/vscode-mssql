/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import {
    FormField,
    generateFormComponent,
    useFormStyles,
} from "../../common/forms/form.component";
import {
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../../common/forms/form";
import {
    ContainerDeploymentWebviewState,
    DockerConnectionProfile,
} from "./containerDeploymentInterfaces";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        alignItems: "left",
        justifyContent: "left",
        marginLeft: "5px",
        marginRight: "5px",
        height: "100%",
        width: "90%",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "fit-content",
        width: "500px",
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
    stepsHeader: {
        width: "100%",
        fontSize: "24px",
        padding: "8px",
        alignItems: "unset",
        textAlign: "left",
    },
    stepsSubheader: {
        width: "100%",
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        padding: "8px",
    },
});

export const ContainerInputForm: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const containerDeploymentState = state?.state;
    const formStyles = useFormStyles();
    const versionOptions: FormItemOptions[] = [
        { displayName: "2022", value: "2022" },
        { displayName: "2019", value: "2019" },
        { displayName: "2017", value: "2017" },
    ] as FormItemOptions[];

    useEffect(() => {
        const validateContainerNameInput = async () => {
            await state.validateContainerName(
                containerDeploymentState.formState.containerName,
            );
        };
        void validateContainerNameInput();
    }, [containerDeploymentState.formState.containerName]);

    const versionFormItem = (): any => {
        const comp = {
            type: FormItemType.Dropdown,
            propertyName: "version",
            label: "SQL Server Container Version",
            required: true,
            tooltip: "SQL Server Container Version",
            options: versionOptions,
        } as FormItemSpec<
            ContainerDeploymentWebviewState,
            DockerConnectionProfile
        >;
        return comp;
    };

    const passwordFormItem = (): any => {
        const comp = {
            type: FormItemType.Password,
            propertyName: "password",
            label: "SQL Server Container Password",
            required: true,
            tooltip: "SQL Server Container Password",
            validate(_, value) {
                if (validateSqlServerPassword(value)) {
                    return {
                        isValid: true,
                        validationMessage: "",
                    };
                }
                return {
                    isValid: false,
                    validationMessage:
                        "Please make your password at least 8 characters",
                };
            },
        } as FormItemSpec<
            ContainerDeploymentWebviewState,
            DockerConnectionProfile
        >;
        return comp;
    };

    const containerNameFormItem = (): any => {
        const comp = {
            type: FormItemType.Input,
            propertyName: "containerName",
            label: "SQL Server Container Name",
            required: false,
            tooltip: "SQL Server Container Name",
            validate(containerDeploymentState, _) {
                return containerDeploymentState.isValidContainerName
                    ? { isValid: true, validationMessage: "" }
                    : {
                          isValid: false,
                          validationMessage:
                              "Please use a unique container name",
                      };
            },
        } as FormItemSpec<
            ContainerDeploymentWebviewState,
            DockerConnectionProfile
        >;
        return comp;
    };

    const acceptDockerEulaFormItem = (): any => {
        const comp = {
            type: FormItemType.Checkbox,
            propertyName: "acceptEula",
            label: "Accept Docker Eula",
            required: true,
            tooltip: "Accept Docker Eula",
        } as FormItemSpec<
            ContainerDeploymentWebviewState,
            DockerConnectionProfile
        >;
        return comp;
    };

    return (
        <div className={classes.outerDiv}>
            <FormField
                context={state}
                component={versionFormItem()}
                idx={0}
                props={{ orientation: "horizontal" }}
            />
            <FormField
                context={state}
                component={passwordFormItem()}
                idx={1}
                props={{ orientation: "horizontal" }}
            />
            <FormField
                context={state}
                component={containerNameFormItem()}
                idx={2}
                props={{ orientation: "horizontal" }}
            />
            <FormField
                context={state}
                component={acceptDockerEulaFormItem()}
                idx={3}
                props={{ orientation: "horizontal" }}
            />
            <div className={formStyles.formNavTray}>
                <div className={formStyles.formNavTrayRight}>
                    <Button
                        className={formStyles.formNavTrayButton}
                        appearance="primary"
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
};

export function validateSqlServerPassword(password): boolean {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/.test(
        password,
    );
}

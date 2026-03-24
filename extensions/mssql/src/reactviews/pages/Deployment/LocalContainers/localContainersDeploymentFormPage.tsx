/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Button, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronRight20Regular,
    ErrorCircleRegular,
} from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    LocalContainersContextProps,
    LocalContainersFormItemSpec,
    LocalContainersState,
    DockerConnectionProfile,
} from "../../../../sharedInterfaces/localContainers";
import { locConstants } from "../../../common/locConstants";
import { ConnectionGroupDialog } from "../../ConnectionGroup/connectionGroup.component";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../../sharedInterfaces/connectionGroup";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        width: "500px",
        whiteSpace: "nowrap",
        minWidth: "800px",
        height: "80vh",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
    },
    bottomDiv: {
        bottom: 0,
        paddingBottom: "50px",
    },
    formDiv: {
        flexGrow: 1,
    },
    spinnerDiv: {
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

interface LocalContainersDeploymentFormPageProps {
    onValidated?: () => void;
}

export const LocalContainersDeploymentFormPage: React.FC<
    LocalContainersDeploymentFormPageProps
> = ({ onValidated }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const dialog = useDeploymentSelector((s) => s.dialog);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!context || !localContainersState) return undefined;

    useEffect(() => {
        if (localContainersState.isDockerProfileValid) {
            onValidated?.();
        }
    }, [localContainersState.isDockerProfileValid, onValidated]);

    if (localContainersState.loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.localContainers.loadingLocalContainers}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (localContainersState.loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{localContainersState.errorMessage ?? ""}</Text>
            </div>
        );
    }

    const { formComponents } = localContainersState;
    const eulaComponent = Object.values(formComponents).find(
        (component) => component.propertyName === "acceptEula",
    )!;

    const renderFormFields = (isAdvanced: boolean) =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.isAdvancedOption === isAdvanced &&
                    component.propertyName !== "acceptEula" &&
                    component.propertyName !== "groupId",
            )
            .map((component, index) => (
                <div
                    key={index}
                    style={
                        component.componentWidth
                            ? {
                                  width: component.componentWidth,
                                  maxWidth: component.componentWidth,
                                  whiteSpace: "normal",
                                  overflowWrap: "break-word",
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        DockerConnectionProfile,
                        LocalContainersState,
                        LocalContainersFormItemSpec,
                        LocalContainersContextProps
                    >
                        context={context}
                        formState={localContainersState.formState}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                {dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        mode="modal"
                        state={(dialog as CreateConnectionGroupDialogProps).props}
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={() => context.setConnectionGroupDialogState(false)}
                    />
                )}
                {renderFormFields(false)}
                <FormField<
                    DockerConnectionProfile,
                    LocalContainersState,
                    LocalContainersFormItemSpec,
                    LocalContainersContextProps
                >
                    context={context}
                    formState={localContainersState.formState}
                    component={
                        localContainersState.formComponents[
                            "groupId"
                        ] as LocalContainersFormItemSpec
                    }
                    idx={0}
                    componentProps={{
                        onSelect: (option: SearchableDropdownOptions) => {
                            if (option.value === CREATE_NEW_GROUP_ID) {
                                context.setConnectionGroupDialogState(true);
                            } else {
                                context.formAction({
                                    propertyName: "groupId",
                                    isAction: false,
                                    value: option.value,
                                });
                            }
                        },
                        renderDecoration: (option: SearchableDropdownOptions) => {
                            return renderColorSwatch(option.color);
                        },
                    }}
                />
                <div>
                    <Button
                        icon={
                            showAdvancedOptions ? (
                                <ChevronDown20Regular />
                            ) : (
                                <ChevronRight20Regular />
                            )
                        }
                        appearance="subtle"
                        onClick={() => setShowAdvanced(!showAdvancedOptions)}
                    />
                    {locConstants.connectionDialog.advancedOptions}
                </div>

                {showAdvancedOptions && (
                    <div className={classes.advancedOptionsDiv}>{renderFormFields(true)}</div>
                )}
            </div>
            <div className={classes.bottomDiv}>
                <hr style={{ background: tokens.colorNeutralBackground2 }} />
                <div
                    style={{
                        ...(eulaComponent.componentWidth && {
                            width: eulaComponent.componentWidth,
                        }),
                        marginTop: "10px",
                    }}>
                    <FormField<
                        DockerConnectionProfile,
                        LocalContainersState,
                        LocalContainersFormItemSpec,
                        LocalContainersContextProps
                    >
                        key={eulaComponent.propertyName}
                        context={context}
                        formState={localContainersState.formState}
                        component={eulaComponent}
                        idx={0}
                    />
                </div>
            </div>
        </div>
    );
};

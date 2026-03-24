/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Button, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronRight20Regular,
    Dismiss20Regular,
    ErrorCircleRegular,
} from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import {
    FabricProvisioningContextProps,
    FabricProvisioningFormItemSpec,
    FabricProvisioningState,
    FabricProvisioningFormState,
} from "../../../../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../../sharedInterfaces/connectionGroup";
import {
    renderColorSwatch,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";
import { ConnectionGroupDialog } from "../../ConnectionGroup/connectionGroup.component";
import { FormItemOptions } from "../../../../sharedInterfaces/form";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: "fit-content",
        padding: "4px 0 8px",
        boxSizing: "border-box",
        whiteSpace: "normal",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
        width: "100%",
        minWidth: 0,
    },
    bottomDiv: {
        paddingBottom: "8px",
    },
    formDiv: {
        flexGrow: 1,
        width: "100%",
        minWidth: 0,
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
    statusRow: {
        display: "flex",
        flexDirection: "row",
        gap: "0.5rem",
        marginTop: "20px",
        marginBottom: "20px",
        width: "100%",
    },
    fieldContainer: {
        width: "100%",
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
    },
    advancedToggle: {
        width: "100%",
    },
});

interface FabricDeploymentFormPageProps {
    onValidated?: () => void;
}

export const FabricDeploymentFormPage: React.FC<FabricDeploymentFormPageProps> = ({
    onValidated,
}) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const fabricProvisioningState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as FabricProvisioningState;
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!context || !fabricProvisioningState) return undefined;

    useEffect(() => {
        if (fabricProvisioningState.formValidationLoadState === ApiStatus.Loaded) {
            onValidated?.();
        }
    }, [fabricProvisioningState.formValidationLoadState, onValidated]);

    if (fabricProvisioningState.loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.fabricProvisioning.loadingFabricProvisioning}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (fabricProvisioningState.loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{fabricProvisioningState.errorMessage ?? ""}</Text>
            </div>
        );
    }

    const fabricComponents = ["accountId", "workspace", "tenantId"];
    const { formComponents } = fabricProvisioningState;

    const renderFormFields = (isAdvanced: boolean) =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.isAdvancedOption === isAdvanced &&
                    component.propertyName !== "groupId" &&
                    !fabricComponents.includes(component.propertyName),
            )
            .map((component, index) => (
                <div key={index} className={classes.fieldContainer}>
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={context}
                        formState={fabricProvisioningState.formState}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    return (
        <div className={classes.outerDiv}>
            <div className={classes.formDiv}>
                {fabricProvisioningState.dialog?.type === "createConnectionGroup" && (
                    <ConnectionGroupDialog
                        mode="modal"
                        state={
                            (fabricProvisioningState.dialog as CreateConnectionGroupDialogProps)
                                .props
                        }
                        saveConnectionGroup={context.createConnectionGroup}
                        closeDialog={() => context.setConnectionGroupDialogState(false)}
                    />
                )}
                <div className={classes.fieldContainer}>
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={context}
                        formState={fabricProvisioningState.formState}
                        component={
                            fabricProvisioningState.formComponents[
                                "accountId"
                            ] as FabricProvisioningFormItemSpec
                        }
                        idx={0}
                        componentProps={{
                            onOptionSelect: (
                                _event: { type: string },
                                data: { optionValue?: string },
                            ) => {
                                context.formAction({
                                    propertyName: "accountId",
                                    isAction: false,
                                    value: data.optionValue as string,
                                });
                                context.reloadFabricEnvironment();
                            },
                        }}
                    />
                </div>
                {renderFormFields(false)}
                <div className={classes.fieldContainer}>
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={context}
                        formState={fabricProvisioningState.formState}
                        component={
                            fabricProvisioningState.formComponents[
                                "groupId"
                            ] as FabricProvisioningFormItemSpec
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
                </div>
                {fabricProvisioningState.formState.accountId && (
                    <div className={classes.fieldContainer}>
                        <FormField<
                            FabricProvisioningFormState,
                            FabricProvisioningState,
                            FabricProvisioningFormItemSpec,
                            FabricProvisioningContextProps
                        >
                            context={context}
                            formState={fabricProvisioningState.formState}
                            component={
                                fabricProvisioningState.formComponents[
                                    "tenantId"
                                ] as FabricProvisioningFormItemSpec
                            }
                            idx={0}
                            componentProps={{
                                onOptionSelect: (
                                    _event: { type: string },
                                    data: { optionValue?: string },
                                ) => {
                                    context.formAction({
                                        propertyName: "tenantId",
                                        isAction: false,
                                        value: data.optionValue as string,
                                    });
                                    context.reloadFabricEnvironment(data.optionValue as string);
                                },
                            }}
                        />
                    </div>
                )}
                {fabricProvisioningState.formState.accountId &&
                    (fabricProvisioningState.workspaces.length > 0 ? (
                        <div className={classes.fieldContainer}>
                            <FormField<
                                FabricProvisioningFormState,
                                FabricProvisioningState,
                                FabricProvisioningFormItemSpec,
                                FabricProvisioningContextProps
                            >
                                context={context}
                                formState={fabricProvisioningState.formState}
                                component={
                                    fabricProvisioningState.formComponents[
                                        "workspace"
                                    ] as FabricProvisioningFormItemSpec
                                }
                                idx={0}
                                componentProps={{
                                    onSelect: async (option: FormItemOptions) => {
                                        await context.handleWorkspaceFormAction(option.value);
                                    },
                                }}
                            />
                        </div>
                    ) : fabricProvisioningState.isWorkspacesErrored ? (
                        <div className={classes.statusRow}>
                            <Dismiss20Regular color={tokens.colorStatusDangerBackground3} />
                            {locConstants.fabricProvisioning.errorLoadingWorkspaces}
                        </div>
                    ) : (
                        <div className={classes.statusRow}>
                            <Spinner size="tiny" />
                            {locConstants.fabricProvisioning.loadingWorkspaces}...
                        </div>
                    ))}

                <div className={classes.advancedToggle}>
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
                    <span>{locConstants.connectionDialog.advancedOptions}</span>
                </div>

                {showAdvancedOptions && (
                    <div className={classes.advancedOptionsDiv}>{renderFormFields(true)}</div>
                )}
            </div>
            <div className={classes.bottomDiv} />
        </div>
    );
};

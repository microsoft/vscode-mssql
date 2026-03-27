/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { Dismiss20Regular, ErrorCircleRegular } from "@fluentui/react-icons";
import { FormField } from "../../../common/forms/form.component";
import { CollapsibleSection } from "../../../common/collapsibleSection";
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
import { useFabricDeploymentSelector } from "../deploymentSelector";

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
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
    bottomDiv: {
        paddingBottom: "8px",
    },
    formDiv: {
        flexGrow: 1,
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
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
        width: "100%",
    },
    fieldContainer: {
        width: "100%",
        minWidth: 0,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
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
    const loadState = useFabricDeploymentSelector((s) => s.loadState);
    const errorMessage = useFabricDeploymentSelector((s) => s.errorMessage);
    const formValidationLoadState = useFabricDeploymentSelector((s) => s.formValidationLoadState);
    const dialog = useFabricDeploymentSelector((s) => s.dialog);
    const formState = useFabricDeploymentSelector((s) => s.formState);
    const formComponents = useFabricDeploymentSelector((s) => s.formComponents);
    const workspaces = useFabricDeploymentSelector((s) => s.workspaces);
    const isWorkspacesErrored = useFabricDeploymentSelector((s) => s.isWorkspacesErrored);

    if (!context || !formState) return undefined;

    useEffect(() => {
        if (formValidationLoadState === ApiStatus.Loaded) {
            onValidated?.();
        }
    }, [formValidationLoadState, onValidated]);

    if (loadState === ApiStatus.Loading) {
        return (
            <div className={classes.spinnerDiv}>
                <Spinner
                    label={locConstants.fabricProvisioning.loadingFabricProvisioning}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (loadState === ApiStatus.Error) {
        return (
            <div className={classes.spinnerDiv}>
                <ErrorCircleRegular className={classes.errorIcon} />
                <Text size={400}>{errorMessage ?? ""}</Text>
            </div>
        );
    }

    const fabricComponents = ["accountId", "workspace", "tenantId"];

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
                        formState={formState}
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
                <div className={classes.fieldContainer}>
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={context}
                        formState={formState}
                        component={formComponents["accountId"] as FabricProvisioningFormItemSpec}
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
                        formState={formState}
                        component={formComponents["groupId"] as FabricProvisioningFormItemSpec}
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
                {formState.accountId && (
                    <div className={classes.fieldContainer}>
                        <FormField<
                            FabricProvisioningFormState,
                            FabricProvisioningState,
                            FabricProvisioningFormItemSpec,
                            FabricProvisioningContextProps
                        >
                            context={context}
                            formState={formState}
                            component={formComponents["tenantId"] as FabricProvisioningFormItemSpec}
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
                {formState.accountId &&
                    (workspaces.length > 0 ? (
                        <div className={classes.fieldContainer}>
                            <FormField<
                                FabricProvisioningFormState,
                                FabricProvisioningState,
                                FabricProvisioningFormItemSpec,
                                FabricProvisioningContextProps
                            >
                                context={context}
                                formState={formState}
                                component={
                                    formComponents["workspace"] as FabricProvisioningFormItemSpec
                                }
                                idx={0}
                                componentProps={{
                                    onSelect: async (option: FormItemOptions) => {
                                        await context.handleWorkspaceFormAction(option.value);
                                    },
                                }}
                            />
                        </div>
                    ) : isWorkspacesErrored ? (
                        <div className={classes.statusRow}>
                            <Dismiss20Regular color={tokens.colorStatusDangerBackground3} />
                            {locConstants.fabricProvisioning.errorLoadingWorkspaces}
                        </div>
                    ) : (
                        <div className={classes.fieldContainer}>
                            <FormField<
                                FabricProvisioningFormState,
                                FabricProvisioningState,
                                FabricProvisioningFormItemSpec,
                                FabricProvisioningContextProps
                            >
                                context={context}
                                formState={formState}
                                component={
                                    formComponents["workspace"] as FabricProvisioningFormItemSpec
                                }
                                idx={0}
                                componentProps={{
                                    disabled: true,
                                    placeholder: `${locConstants.fabricProvisioning.loadingWorkspaces}...`,
                                    onSelect: async () => undefined,
                                }}
                            />
                        </div>
                    ))}
                <CollapsibleSection title={locConstants.connectionDialog.advancedOptions}>
                    <div className={classes.advancedOptionsDiv}>{renderFormFields(true)}</div>
                </CollapsibleSection>
            </div>
            <div className={classes.bottomDiv} />
        </div>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    makeStyles,
    OptionOnSelectData,
    SelectionEvents,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { FormField } from "../../../common/forms/form.component";
import {
    FabricProvisioningContextProps,
    FabricProvisioningFormItemSpec,
    FabricProvisioningState,
    FabricProvisioningFormState,
} from "../../../../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../../sharedInterfaces/connectionGroup";
import { SearchableDropdownOptions } from "../../../common/searchableDropdown.component";
import { ConnectionGroupDialog } from "../../ConnectionGroup/connectionGroup.component";
import { FormItemOptions } from "../../../../sharedInterfaces/form";
import { FabricProvisioningHeader } from "./fabricProvisioningHeader";
import { ProvisionFabricDatabasePage } from "./provisionFabricDatabasePage";
import { DeploymentContext } from "../deploymentStateProvider";

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
    button: {
        height: "32px",
        width: "160px",
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
    buttonContent: {
        display: "flex",
        flexDirection: "row",
        gap: "0.5rem",
    },
});

export const FabricProvisioningInputForm: React.FC = () => {
    const classes = useStyles();
    const state = useContext(DeploymentContext);
    const fabricProvisioningState = state?.state.deploymentTypeState as FabricProvisioningState;

    if (!state || !fabricProvisioningState) return undefined;

    const { formComponents } = fabricProvisioningState;
    const [showAdvancedOptions, setShowAdvanced] = useState(false);
    const [showNext, setShowNext] = useState(false);

    const renderFormFields = (isAdvanced: boolean) =>
        Object.values(formComponents)
            .filter(
                (component) =>
                    component.isAdvancedOption === isAdvanced &&
                    component.propertyName !== "groupId" &&
                    component.propertyName !== "workspace" &&
                    component.propertyName !== "tenantId",
            )
            .map((component, index) => (
                <div
                    key={index}
                    style={
                        component.componentWidth
                            ? {
                                  width: component.componentWidth,
                                  maxWidth: component.componentWidth,
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={state}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const handleSubmit = async () => {
        await state.createDatabase();
    };

    useEffect(() => {
        console.log(fabricProvisioningState.formValidationLoadState);
        setShowNext(fabricProvisioningState.formValidationLoadState === ApiStatus.Loaded);
    }, [fabricProvisioningState.formValidationLoadState]);

    useEffect(() => {}, [fabricProvisioningState.workspaces]);

    return showNext ? (
        <ProvisionFabricDatabasePage />
    ) : (
        <div>
            <FabricProvisioningHeader paddingLeft="20px" />
            <div className={classes.outerDiv}>
                <div className={classes.formDiv}>
                    {fabricProvisioningState.dialog?.type === "createConnectionGroup" && (
                        <ConnectionGroupDialog
                            state={
                                (fabricProvisioningState.dialog as CreateConnectionGroupDialogProps)
                                    .props
                            }
                            saveConnectionGroup={state.createConnectionGroup}
                            closeDialog={() => state.setConnectionGroupDialogState(false)} // shouldOpen is false when closing the dialog
                        />
                    )}
                    {renderFormFields(false)}
                    <FormField<
                        FabricProvisioningFormState,
                        FabricProvisioningState,
                        FabricProvisioningFormItemSpec,
                        FabricProvisioningContextProps
                    >
                        context={state}
                        component={
                            fabricProvisioningState.formComponents[
                                "groupId"
                            ] as FabricProvisioningFormItemSpec
                        }
                        idx={0}
                        componentProps={{
                            onSelect: (option: SearchableDropdownOptions) => {
                                if (option.value === CREATE_NEW_GROUP_ID) {
                                    state.setConnectionGroupDialogState(true); // shouldOpen is true when opening the dialog
                                } else {
                                    state.formAction({
                                        propertyName: "groupId",
                                        isAction: false,
                                        value: option.value,
                                    });
                                }
                            },
                        }}
                    />
                    {fabricProvisioningState.formState.accountId && (
                        <FormField<
                            FabricProvisioningFormState,
                            FabricProvisioningState,
                            FabricProvisioningFormItemSpec,
                            FabricProvisioningContextProps
                        >
                            context={state}
                            component={
                                fabricProvisioningState.formComponents[
                                    "tenantId"
                                ] as FabricProvisioningFormItemSpec
                            }
                            idx={0}
                            componentProps={{
                                onOptionSelect: (
                                    _event: SelectionEvents,
                                    data: OptionOnSelectData,
                                ) => {
                                    state.formAction({
                                        propertyName: "tenantId",
                                        isAction: false,
                                        value: data.optionValue as string,
                                    });
                                    state.reloadFabricEnvironment(data.optionValue as string);
                                },
                            }}
                        />
                    )}
                    {fabricProvisioningState.workspaces.length > 0 ? (
                        <FormField<
                            FabricProvisioningFormState,
                            FabricProvisioningState,
                            FabricProvisioningFormItemSpec,
                            FabricProvisioningContextProps
                        >
                            context={state}
                            component={
                                fabricProvisioningState.formComponents[
                                    "workspace"
                                ] as FabricProvisioningFormItemSpec
                            }
                            idx={0}
                            componentProps={{
                                onSelect: async (option: FormItemOptions) => {
                                    await state.handleWorkspaceFormAction(option.value);
                                },
                            }}
                        />
                    ) : (
                        <div
                            className={classes.buttonContent}
                            style={{ marginTop: "20px", marginBottom: "20px" }}>
                            <Spinner size="tiny" />
                            {locConstants.fabricProvisioning.loadingWorkspaces}...
                        </div>
                    )}

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
                    {fabricProvisioningState.formValidationLoadState === ApiStatus.Loading ? (
                        <Button
                            className={classes.button}
                            type="submit"
                            appearance="secondary"
                            disabled>
                            <div className={classes.buttonContent}>
                                <Spinner size="extra-tiny" />
                                {locConstants.fabricProvisioning.createDatabase}
                            </div>
                        </Button>
                    ) : (
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            {locConstants.fabricProvisioning.createDatabase}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

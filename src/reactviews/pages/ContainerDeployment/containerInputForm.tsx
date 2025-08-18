/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import { ContainerSetupStepsPage } from "./containerSetupStepsPage";
import {
    ContainerDeploymentContextProps,
    ContainerDeploymentFormItemSpec,
    ContainerDeploymentWebviewState,
    DockerConnectionProfile,
} from "../../../sharedInterfaces/containerDeployment";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";
import { ConnectionGroupDialog } from "../ConnectionGroup/connectionGroup.component";
import {
    CREATE_NEW_GROUP_ID,
    CreateConnectionGroupDialogProps,
} from "../../../sharedInterfaces/connectionGroup";
import { SearchableDropdownOptions } from "../../common/searchableDropdown.component";
import { ApiStatus } from "../../../sharedInterfaces/webview";

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

export const ContainerInputForm: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [showAdvancedOptions, setShowAdvanced] = useState(false);

    if (!state) return undefined;

    const { formComponents } = state.state;
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
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
                                  wordBreak: "break-word",
                              }
                            : {}
                    }>
                    <FormField<
                        DockerConnectionProfile,
                        ContainerDeploymentWebviewState,
                        ContainerDeploymentFormItemSpec,
                        ContainerDeploymentContextProps
                    >
                        context={state}
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const handleSubmit = async () => {
        await state.checkDockerProfile();
    };

    useEffect(() => {
        setShowNext(state.state.isDockerProfileValid);
    }, [state]);

    return showNext ? (
        <ContainerSetupStepsPage />
    ) : (
        <div>
            <ContainerDeploymentHeader
                headerText={locConstants.containerDeployment.sqlServerContainerHeader}
                paddingLeft="20px"
            />
            <div className={classes.outerDiv}>
                <div className={classes.formDiv}>
                    {state.state.dialog?.type === "createConnectionGroup" && (
                        <ConnectionGroupDialog
                            state={(state.state.dialog as CreateConnectionGroupDialogProps).props}
                            saveConnectionGroup={state.createConnectionGroup}
                            closeDialog={() => state.setConnectionGroupDialogState(false)} // shouldOpen is false when closing the dialog
                        />
                    )}
                    {renderFormFields(false)}
                    <FormField<
                        DockerConnectionProfile,
                        ContainerDeploymentWebviewState,
                        ContainerDeploymentFormItemSpec,
                        ContainerDeploymentContextProps
                    >
                        context={state}
                        component={
                            state.state.formComponents["groupId"] as ContainerDeploymentFormItemSpec
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
                        {locConstants.containerDeployment.advancedOptions}
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
                            ContainerDeploymentWebviewState,
                            ContainerDeploymentFormItemSpec,
                            ContainerDeploymentContextProps
                        >
                            key={eulaComponent.propertyName}
                            context={state}
                            component={eulaComponent}
                            idx={0}
                        />
                    </div>
                    {state.state?.formValidationLoadState === ApiStatus.Loading ? (
                        <Button
                            className={classes.button}
                            type="submit"
                            appearance="secondary"
                            disabled>
                            <div className={classes.buttonContent}>
                                <Spinner size="extra-tiny" />
                                {locConstants.containerDeployment.createContainer}
                            </div>
                        </Button>
                    ) : (
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            {locConstants.containerDeployment.createContainer}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

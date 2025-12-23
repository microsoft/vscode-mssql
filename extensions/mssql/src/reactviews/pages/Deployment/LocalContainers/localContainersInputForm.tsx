/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Button, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { FormField } from "../../../common/forms/form.component";
import { LocalContainersSetupStepsPage } from "./localContainersSetupStepsPage";
import {
    LocalContainersContextProps,
    LocalContainersFormItemSpec,
    LocalContainersState,
    DockerConnectionProfile,
} from "../../../../sharedInterfaces/localContainers";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { LocalContainersHeader } from "./localContainersHeader";
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
import { ArmSql2025ErrorDialog } from "./armSql2025ErrorDialog";

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

export const LocalContainersInputForm: React.FC = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [showAdvancedOptions, setShowAdvanced] = useState(false);
    const deploymentState = context?.state;
    const localContainersState = deploymentState?.deploymentTypeState as LocalContainersState;

    if (!context || !deploymentState || !localContainersState) return undefined;

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
                                  whiteSpace: "normal", // allows wrapping
                                  overflowWrap: "break-word", // breaks long words if needed
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
                        component={component}
                        idx={index}
                    />
                </div>
            ));

    const handleSubmit = async () => {
        await context.checkDockerProfile();
    };

    useEffect(() => {
        setShowNext(localContainersState.isDockerProfileValid);
    }, [localContainersState.isDockerProfileValid]);

    return showNext ? (
        <LocalContainersSetupStepsPage />
    ) : (
        <div>
            <LocalContainersHeader
                headerText={locConstants.localContainers.sqlServerContainerHeader}
                paddingLeft="20px"
            />
            <div className={classes.outerDiv}>
                <div className={classes.formDiv}>
                    {deploymentState.dialog?.type === "createConnectionGroup" && (
                        <ConnectionGroupDialog
                            state={
                                (deploymentState.dialog as CreateConnectionGroupDialogProps).props
                            }
                            saveConnectionGroup={context.createConnectionGroup}
                            closeDialog={() => context.setConnectionGroupDialogState(false)} // shouldOpen is false when closing the dialog
                        />
                    )}
                    {deploymentState.dialog?.type === "armSql2025Error" && (
                        <ArmSql2025ErrorDialog closeDialog={context.closeArmSql2025ErrorDialog} />
                    )}
                    {renderFormFields(false)}
                    <FormField<
                        DockerConnectionProfile,
                        LocalContainersState,
                        LocalContainersFormItemSpec,
                        LocalContainersContextProps
                    >
                        context={context}
                        component={
                            localContainersState.formComponents[
                                "groupId"
                            ] as LocalContainersFormItemSpec
                        }
                        idx={0}
                        componentProps={{
                            onSelect: (option: SearchableDropdownOptions) => {
                                if (option.value === CREATE_NEW_GROUP_ID) {
                                    context.setConnectionGroupDialogState(true); // shouldOpen is true when opening the dialog
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
                            component={eulaComponent}
                            idx={0}
                        />
                    </div>
                    {localContainersState.formValidationLoadState === ApiStatus.Loading ? (
                        <Button
                            className={classes.button}
                            type="submit"
                            appearance="secondary"
                            disabled>
                            <div className={classes.buttonContent}>
                                <Spinner size="extra-tiny" />
                                {locConstants.localContainers.createContainer}
                            </div>
                        </Button>
                    ) : (
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            {locConstants.localContainers.createContainer}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

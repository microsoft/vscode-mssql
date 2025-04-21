/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import { ContainerSetupStepsPage } from "./containerSetupStepsPage";
import {
    ContainerDeploymentContextProps,
    ContainerDeploymentFormItemSpec,
    ContainerDeploymentWebviewState,
    DockerConnectionProfile,
} from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginLeft: "5px",
        marginRight: "5px",
        padding: "8px",
        height: "85%",
        width: "500px",
        whiteSpace: "nowrap",
    },
    button: {
        height: "28px",
        width: "130px",
    },
    advancedOptionsDiv: {
        marginLeft: "24px",
    },
    bottomDiv: {
        marginTop: "auto",
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
                    component.propertyName !== "acceptEula",
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
        <div className={classes.outerDiv}>
            {renderFormFields(false)}
            <div>
                <Button
                    icon={
                        showAdvancedOptions ? <ChevronDown20Regular /> : <ChevronRight20Regular />
                    }
                    appearance="subtle"
                    onClick={() => setShowAdvanced(!showAdvancedOptions)}
                />
                Advanced Options
            </div>

            {showAdvancedOptions && (
                <div className={classes.advancedOptionsDiv}>{renderFormFields(true)}</div>
            )}

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
                <Button
                    className={classes.button}
                    type="submit"
                    onClick={() => handleSubmit()}
                    appearance={"primary"}>
                    Create Container
                </Button>
            </div>
        </div>
    );
};

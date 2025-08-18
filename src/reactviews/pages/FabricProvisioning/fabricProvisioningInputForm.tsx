/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Button, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { FormField } from "../../common/forms/form.component";
import {
    FabricProvisioningContextProps,
    FabricProvisioningFormItemSpec,
    FabricProvisioningWebviewState,
    FabricProvisioningFormState,
} from "../../../sharedInterfaces/fabricProvisioning";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";

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
    const state = useContext(FabricProvisioningContext);
    const fabricProvisioningState = state?.state;

    if (!state || !fabricProvisioningState) return undefined;

    const { formComponents } = fabricProvisioningState;

    const renderFormFields = () =>
        Object.values(formComponents).map((component, index) => (
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
                    FabricProvisioningWebviewState,
                    FabricProvisioningFormItemSpec,
                    FabricProvisioningContextProps
                >
                    context={state}
                    component={component}
                    idx={index}
                />
            </div>
        ));

    const handleSubmit = async () => {};

    return (
        <div>
            hello
            <div className={classes.outerDiv}>
                {renderFormFields()}
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
                                Loading
                            </div>
                        </Button>
                    ) : (
                        <Button
                            className={classes.button}
                            type="submit"
                            onClick={() => handleSubmit()}
                            appearance="primary">
                            Submit
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

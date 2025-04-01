/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { ContainerSetupStepsPage } from "./containerSetupStepsPage";
import {
    ContainerDeploymentContextProps,
    ContainerDeploymentFormItemSpec,
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
    const formStyles = useFormStyles();

    // If this passes, state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state) {
        return undefined;
    }

    const [showNext, setShowNext] = useState(false);

    return showNext ? (
        <ContainerSetupStepsPage />
    ) : (
        <div className={classes.outerDiv}>
            {Object.values(state.state.formComponents).map(
                (component, index) => (
                    <FormField<
                        DockerConnectionProfile,
                        ContainerDeploymentWebviewState,
                        ContainerDeploymentFormItemSpec,
                        ContainerDeploymentContextProps
                    >
                        key={index}
                        context={state}
                        component={component}
                        idx={index}
                        props={{ orientation: "vertical" }}
                    />
                ),
            )}
            <div className={formStyles.formNavTray}>
                <div className={formStyles.formNavTrayRight}>
                    <Button
                        className={classes.button}
                        onClick={() => {
                            setShowNext(true);
                        }}
                        appearance="primary"
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
};

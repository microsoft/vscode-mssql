/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import {
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../../common/forms/form";
import {
    ContainerDeploymentWebviewState,
    DockerConnectionProfile,
} from "./containerDeploymentInterfaces";
import { ContainerSetupStepsPage } from "./containerSetupStepsPage";

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

    const [showNext, setShowNext] = useState(false);

    return showNext ? (
        <ContainerSetupStepsPage />
    ) : (
        <div className={classes.outerDiv}>
            {Object.values(state.state.formComponents).map(
                (component, index) => (
                    <FormField
                        key={index}
                        context={state}
                        component={component}
                        idx={index}
                        props={{ orientation: "horizontal" }}
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { useStyles } from "../ConnectionDialog/connectionPage";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { Button } from "@fluentui/react-components";

export const ContainerInputForm: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const containerDeploymentState = state?.state.containerDeploymentState;

    return <div>Hi</div>;
};

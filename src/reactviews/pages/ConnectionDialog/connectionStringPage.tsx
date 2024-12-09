/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { FormItemSpec } from "../../common/forms/form";
import { ConnectButton } from "./components/connectButton.component";
import { TextareaProps } from "@fluentui/react-components";

export const ConnectionStringPage = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();

    if (connectionDialogContext === undefined) {
        return undefined;
    }

    let index = 0;
    return (
        <div>
            <FormField
                key={index++}
                context={connectionDialogContext}
                component={
                    connectionDialogContext.state.connectionComponents
                        .components[
                        "connectionString"
                    ] as FormItemSpec<IConnectionDialogProfile>
                }
                idx={index}
                props={{ orientation: "horizontal" }}
                componentProps={
                    {
                        style: { height: "200px" },
                    } as TextareaProps
                }
            />
            <div className={formStyles.formNavTray}>
                <div className={formStyles.formNavTrayRight}>
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};

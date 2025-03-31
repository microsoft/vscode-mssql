/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { ConnectButton } from "./components/connectButton.component";
import { TextareaProps } from "@fluentui/react-components";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";

export const ConnectionStringPage = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    const formStyles = useFormStyles();

    if (connectionDialogContext === undefined) {
        return undefined;
    }

    let index = 0;
    return (
        <div>
            <FormField<
                IConnectionDialogProfile,
                ConnectionDialogWebviewState,
                ConnectionDialogFormItemSpec,
                ConnectionDialogContextProps
            >
                key={index++}
                context={connectionDialogContext}
                component={connectionDialogContext.state.formComponents["connectionString"]!}
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

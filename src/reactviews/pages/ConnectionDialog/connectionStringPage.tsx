/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField } from "../../common/forms/form.component";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { FormItemSpec } from "../../common/forms/form";
import { ConnectButton } from "./connectButton";

export const ConnectionStringPage = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);

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
            />

            <ConnectButton />
        </div>
    );
};

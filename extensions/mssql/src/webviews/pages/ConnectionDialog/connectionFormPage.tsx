/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { FormField } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";

export const ConnectionFormPage = () => {
    const context = useContext(ConnectionDialogContext);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const formState = useConnectionDialogSelector((s) => s.formState);

    if (context === undefined) {
        return undefined;
    }

    return (
        <div>
            {mainOptions.map((inputName, idx) => {
                const component = formComponents[inputName as keyof IConnectionDialogProfile];
                if (component?.hidden !== false) {
                    return undefined;
                }

                return (
                    <FormField<
                        IConnectionDialogProfile,
                        ConnectionDialogWebviewState,
                        ConnectionDialogFormItemSpec,
                        ConnectionDialogContextProps
                    >
                        key={idx}
                        context={context}
                        formState={formState}
                        component={component}
                        idx={idx}
                        props={{ orientation: "horizontal" }}
                    />
                );
            })}
        </div>
    );
};

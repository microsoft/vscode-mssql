/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { FormFieldNoState, useFormStyles } from "../../common/forms/form.component";
import {
    ConnectionDialogContextProps,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { ConnectButton } from "./components/connectButton.component";
import { locConstants } from "../../common/locConstants";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";

export const ConnectionFormPage = () => {
    const context = useContext(ConnectionDialogContext);
    const mainOptions = useConnectionDialogSelector((s) => s.connectionComponents.mainOptions);
    const formComponents = useConnectionDialogSelector((s) => s.formComponents);
    const formState = useConnectionDialogSelector((s) => s.formState);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const formStyles = useFormStyles();

    if (context === undefined) {
        return undefined;
    }

    return (
        <div>
            {mainOptions.map((inputName, idx) => {
                const component =
                    formComponents[inputName as keyof IConnectionDialogProfile];
                if (component?.hidden !== false) {
                    return undefined;
                }

                return (
                    <FormFieldNoState<
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
            <AdvancedOptionsDrawer
                isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
            />
            <div className={formStyles.formNavTray}>
                <Button
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    className={formStyles.formNavTrayButton}>
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};

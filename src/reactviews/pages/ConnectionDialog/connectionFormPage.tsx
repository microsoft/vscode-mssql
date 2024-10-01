/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { ConnectButton } from "./components/connectButton.component";
import { locConstants } from "../../common/locConstants";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";

export const ConnectionFormPage = () => {
    const context = useContext(ConnectionDialogContext);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const formStyles = useFormStyles();

    if (context === undefined) {
        return undefined;
    }

    return (
        <div>
            {context.state.connectionComponents.mainOptions.map(
                (inputName, idx) => {
                    const component =
                        context.state.connectionComponents.components[
                            inputName as keyof IConnectionDialogProfile
                        ];
                    if (component.hidden === true) {
                        return undefined;
                    }

                    return (
                        <FormField
                            key={idx}
                            context={context}
                            component={
                                component as FormItemSpec<IConnectionDialogProfile>
                            }
                            idx={idx}
                            props={{ orientation: "horizontal" }}
                        />
                    );
                },
            )}
            <AdvancedOptionsDrawer
                isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
            />
            <div className={formStyles.formNavTray}>
                <Button
                    shape="square"
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    className={formStyles.formNavTrayButton}
                >
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <ConnectButton className={formStyles.formNavTrayButton} />
                </div>
            </div>
        </div>
    );
};

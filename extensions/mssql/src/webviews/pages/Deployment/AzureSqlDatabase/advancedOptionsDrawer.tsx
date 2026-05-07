/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Field,
    Input,
    Option,
    OverlayDrawer,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useFormStyles } from "../../../common/forms/form.component";
import { locConstants as Loc } from "../../../common/locConstants";

export const AdvancedOptionsDrawer = ({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) => {
    const formStyles = useFormStyles();

    return (
        <OverlayDrawer
            position="end"
            size="medium"
            open={open}
            onOpenChange={(_, { open }) => {
                if (!open) {
                    onClose();
                }
            }}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={onClose}
                        />
                    }>
                    {Loc.azureSqlDatabase.advanced}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1 }}>
                    <Field
                        className={formStyles.formComponentDiv}
                        label={Loc.azureSqlDatabase.backupRedundancy}>
                        <Dropdown
                            defaultValue={Loc.azureSqlDatabase.locallyRedundant}
                            defaultSelectedOptions={["local"]}>
                            <Option value="local">{Loc.azureSqlDatabase.locallyRedundant}</Option>
                            <Option value="zone">{Loc.azureSqlDatabase.zoneRedundant}</Option>
                            <Option value="geo">{Loc.azureSqlDatabase.geoRedundant}</Option>
                        </Dropdown>
                    </Field>
                    <Field
                        className={formStyles.formComponentDiv}
                        label={Loc.azureSqlDatabase.collation}>
                        <Input defaultValue="SQL_Latin1_General_CP1_CI_AS" />
                    </Field>
                    <Field
                        className={formStyles.formComponentDiv}
                        label={Loc.azureSqlDatabase.connectionTimeout}>
                        <Input type="number" defaultValue="30" />
                    </Field>
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        paddingBottom: "16px",
                    }}>
                    <Button appearance="secondary" onClick={onClose}>
                        {Loc.common.close}
                    </Button>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerEditor } from "./schemaDesignerEditor";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";
import { locConstants } from "../../../common/locConstants";

export const SchemaDesignerEditorDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    return (
        <OverlayDrawer
            position={"end"}
            open={context.isEditDrawerOpen}
            onOpenChange={(_, { open }) => context.setIsEditDrawerOpen(open)}
            style={{ width: `600px` }}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<FluentIcons.Dismiss24Regular />}
                            onClick={() => context.setIsEditDrawerOpen(false)}
                        />
                    }
                >
                    {locConstants.schemaDesigner.editTable}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <SchemaDesignerEditor />
            </DrawerBody>
        </OverlayDrawer>
    );
};

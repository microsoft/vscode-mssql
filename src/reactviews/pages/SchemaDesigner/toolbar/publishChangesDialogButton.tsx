/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);
    return (
        <Dialog>
            <DialogTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    icon={<FluentIcons.DatabaseArrowUp16Filled />}
                    title={locConstants.schemaDesigner.publishChanges}
                    appearance="subtle"
                    disabled={context.isPublishChangesEnabled === false}
                    onClick={() => {
                        context.getReport();
                    }}
                >
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Publish changes</DialogTitle>
                    <DialogContent>
                        Lorem ipsum dolor sit amet consectetur adipisicing elit.
                        Quisquam exercitationem cumque repellendus eaque est
                        dolor eius expedita nulla ullam? Tenetur reprehenderit
                        aut voluptatum impedit voluptates in natus iure cumque
                        eaque?
                    </DialogContent>
                    <DialogActions>
                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="primary">Close</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dialog,
    DialogTrigger,
    Button,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";

export function ViewCodeDialogButton() {
    return (
        <Dialog>
            <DialogTrigger disableButtonEnhancement>
                <Button
                    style={{
                        minWidth: "103px",
                    }}
                    size="small"
                    icon={<FluentIcons.Code16Filled />}
                >
                    View Code
                </Button>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Code for the table</DialogTitle>
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

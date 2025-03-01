/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";

export function SchemaDiagramZoomControls() {
    return (
        <div
            style={{
                position: "absolute",
                bottom: "10px",
                left: "10px",
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                gap: "10px",
            }}
        >
            <Button icon={<FluentIcons.ZoomIn20Regular />}></Button>
            <Button icon={<FluentIcons.ZoomOut20Regular />}></Button>
            <Button icon={<FluentIcons.ZoomFitRegular />}></Button>
        </div>
    );
}

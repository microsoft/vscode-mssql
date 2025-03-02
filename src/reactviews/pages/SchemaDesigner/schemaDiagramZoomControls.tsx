/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";

export function SchemaDiagramZoomControls() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    function zoomIn() {
        if (context?.schemaDesigner) {
            context.schemaDesigner.zoomIn();
        }
    }

    function zoomOut() {
        if (context?.schemaDesigner) {
            context.schemaDesigner.zoomOut();
        }
    }

    function zoomFit() {
        if (context?.schemaDesigner) {
            context.schemaDesigner.zoomToFit();
        }
    }

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
            <Button
                onClick={() => zoomIn()}
                icon={<FluentIcons.ZoomIn20Regular />}
                title={locConstants.schemaDesigner.zoomIn}
            />
            <Button
                onClick={() => zoomOut()}
                icon={<FluentIcons.ZoomOut20Regular />}
                title={locConstants.schemaDesigner.zoomOut}
            />
            <Button
                onClick={() => zoomFit()}
                icon={<FluentIcons.ZoomFitRegular />}
                title={locConstants.schemaDesigner.zoomToFit}
            />
        </div>
    );
}

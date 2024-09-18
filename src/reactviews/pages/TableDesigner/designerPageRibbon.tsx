/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-toolbar";
import { DocumentChevronDoubleRegular } from "@fluentui/react-icons";
import {
    Divider,
    Spinner,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { LoadState } from "../../../sharedInterfaces/tableDesigner";
import { DesignerChangesPreviewButton } from "./designerChangesPreviewButton";
import * as l10n from "@vscode/l10n";

const useStyles = makeStyles({
    separator: {
        ...shorthands.margin("0px", "-20px", "0px", "0px"),
        ...shorthands.padding("0px"),
        fontSize: "5px",
    },
});

export const DesignerPageRibbon = () => {
    const designerContext = useContext(TableDesignerContext);
    const classes = useStyles();
    if (!designerContext) {
        return null;
    }

    const GENERATE_SCRIPT = l10n.t("Generate Script");
    const SCRIPT_AS_CREATE = l10n.t("Script As Create");

    return (
        <div>
            <Toolbar size="small">
                <ToolbarButton
                    aria-label={GENERATE_SCRIPT}
                    title={GENERATE_SCRIPT}
                    icon={<DocumentChevronDoubleRegular />}
                    onClick={() => {
                        designerContext.provider.generateScript();
                    }}
                    disabled={(designerContext.state.issues?.length ?? 0) > 0}
                >
                    {GENERATE_SCRIPT}{" "}
                    {designerContext.state.apiState?.generateScriptState ===
                        LoadState.Loading && (
                        <Spinner
                            style={{
                                marginLeft: "5px",
                            }}
                            size="extra-small"
                        />
                    )}
                </ToolbarButton>
                <ToolbarButton
                    aria-label={SCRIPT_AS_CREATE}
                    title={SCRIPT_AS_CREATE}
                    icon={<DocumentChevronDoubleRegular />}
                    onClick={() => {
                        designerContext.provider.scriptAsCreate();
                    }}
                >
                    {SCRIPT_AS_CREATE}
                </ToolbarButton>
                <DesignerChangesPreviewButton />
            </Toolbar>
            <Divider className={classes.separator} />
        </div>
    );
};

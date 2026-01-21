/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { ToolbarButton, Tooltip, CounterBadge } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import * as l10n from "@vscode/l10n";

const LOC = {
    showDiffView: l10n.t("Show Changes"),
    hideDiffView: l10n.t("Hide Changes"),
    diffViewTooltip: l10n.t("Toggle diff view to see schema changes"),
    noChanges: l10n.t("No changes"),
};

/**
 * Toggle button for enabling/disabling diff view mode
 */
export const DiffViewToggleButton = () => {
    const context = useContext(SchemaDesignerContext);

    // Get the count of changes
    const changeCount = useMemo(() => {
        if (!context.originalSchema) return 0;
        const entries = context.getChangeEntries();
        return entries.length;
    }, [context.originalSchema, context.schemaChangeVersion]);

    const handleToggle = () => {
        context.setDiffViewEnabled(!context.isDiffViewEnabled);
    };

    // Don't show button if not initialized
    if (!context.isInitialized) {
        return undefined;
    }

    return (
        <Tooltip
            content={context.isDiffViewEnabled ? LOC.hideDiffView : LOC.showDiffView}
            relationship="label">
            <ToolbarButton
                aria-label={LOC.diffViewTooltip}
                icon={
                    context.isDiffViewEnabled ? (
                        <FluentIcons.DocumentBulletListFilled />
                    ) : (
                        <FluentIcons.DocumentBulletListRegular />
                    )
                }
                onClick={handleToggle}
                appearance={context.isDiffViewEnabled ? "primary" : undefined}
                style={{
                    position: "relative",
                }}>
                {LOC.showDiffView}
                {changeCount > 0 && (
                    <CounterBadge
                        count={changeCount}
                        size="small"
                        color="informative"
                        style={{
                            marginLeft: "6px",
                        }}
                    />
                )}
            </ToolbarButton>
        </Tooltip>
    );
};

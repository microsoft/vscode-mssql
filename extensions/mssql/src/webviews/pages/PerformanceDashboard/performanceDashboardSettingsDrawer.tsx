/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OverlayDrawer } from "@fluentui/react-components";
import { PerformanceDashboardQueryStoreSettings } from "./performanceDashboardQueryStoreSettings";
import { SettingsSection } from "./performanceDashboardRoutes";

export interface PerformanceDashboardSettingsDrawerProps {
    /** The settings section to show. Query Store is the only section for now. */
    readonly section: SettingsSection;
    readonly onClose: () => void;
}

/** The dashboard settings, in a drawer on the right that covers the dashboard. */
export const PerformanceDashboardSettingsDrawer = ({
    onClose,
}: PerformanceDashboardSettingsDrawerProps) => (
    <OverlayDrawer
        open
        position="end"
        size="medium"
        onOpenChange={(_event, data) => !data.open && onClose()}>
        <PerformanceDashboardQueryStoreSettings onClose={onClose} />
    </OverlayDrawer>
);

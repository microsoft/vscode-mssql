/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Color Constants
export { DIFF_COLORS, getDiffColor } from "./colorConstants";
export type { DiffColorType } from "./colorConstants";

// Services
export {
    ChangeCountTracker,
    getChangeCountTracker,
    resetChangeCountTracker,
} from "./changeCountTracker";
export { DiffCalculator, getDiffCalculator } from "./diffCalculator";

// Context
export {
    DiffViewerProvider,
    useDiffViewer,
    useDiffViewerOptional,
    useDiffViewerState,
    useChangeCounts,
} from "./diffViewerContext";

// Integration
export { DiffViewerIntegration } from "./diffViewerIntegration";

// Components
export { ChangeItem } from "./changeItem";
export type { ChangeItemProps } from "./changeItem";

export { ChangeGroup } from "./changeGroup";
export type { ChangeGroupProps } from "./changeGroup";

export { ChangesList } from "./changesList";
export type { ChangesListProps } from "./changesList";

export { DiffViewerDrawer } from "./diffViewerDrawer";
export type { DiffViewerDrawerProps } from "./diffViewerDrawer";

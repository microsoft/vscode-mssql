/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    TeachingPopover,
    TeachingPopoverBody,
    TeachingPopoverFooter,
    TeachingPopoverSurface,
    TeachingPopoverTitle,
} from "@fluentui/react-components";

export interface FeatureDiscoveryPopoverProps {
    open: boolean;
    target: HTMLElement | null;
    title: string;
    body: string;
    primaryActionLabel: string;
    secondaryActionLabel: string;
    onPrimaryAction: () => void | Promise<void>;
    onDismiss: () => void;
}

export function FeatureDiscoveryPopover({
    open,
    target,
    title,
    body,
    primaryActionLabel,
    secondaryActionLabel,
    onPrimaryAction,
    onDismiss,
}: FeatureDiscoveryPopoverProps) {
    if (!target) {
        return null;
    }

    return (
        <TeachingPopover
            open={open}
            trapFocus={false}
            unstable_disableAutoFocus
            positioning={{ position: "below", align: "center", target }}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onDismiss();
                }
            }}>
            <TeachingPopoverSurface style={{ maxWidth: "250px" }}>
                <TeachingPopoverBody>
                    <TeachingPopoverTitle>{title}</TeachingPopoverTitle>
                    <Body1>{body}</Body1>
                </TeachingPopoverBody>
                <TeachingPopoverFooter
                    primary={{
                        children: primaryActionLabel,
                        onClick: () => void onPrimaryAction(),
                    }}
                    secondary={{
                        children: secondaryActionLabel,
                        onClick: onDismiss,
                    }}
                />
            </TeachingPopoverSurface>
        </TeachingPopover>
    );
}

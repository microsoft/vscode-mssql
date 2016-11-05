/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Input, Output, EventEmitter } from '@angular/core';

/**
 * The component that handles the navigation for the results UI
 */

@Component({
    selector: 'navigator',
    templateUrl: 'dist/html/navigation.component.html'
})

export class NavigatorComponent {
    @Input() batches: number[][];
    @Output() selectionChange: EventEmitter<{ batch: number; result: number; }> = new EventEmitter<{ batch: number; result: number; }>();

    /**
     * Emits the selected value that was chosen in the navigator
     * @param value The Json object to emit in the event
     */
    public selected(value: {batch: number; result: number; }): void {
        this.selectionChange.emit(value);
    }
}

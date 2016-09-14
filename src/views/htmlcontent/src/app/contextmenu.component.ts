/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Output, EventEmitter } from '@angular/core';

/**
 * The component that acts as the contextMenu for slick grid
 */

@Component({
    selector: 'context-menu',
    templateUrl: 'app/contextmenu.component.html'
})

export class ContextMenu {
    @Output() clickEvent: EventEmitter<{type: string, batchId: number, resultId: number}>
        = new EventEmitter<{type: string, batchId: number, resultId: number}>();
    private batchId: number;
    private resultId: number;

    show(x: number, y: number, batchId: number, resultId: number): void {
        this.batchId = batchId;
        this.resultId = resultId;
        $('.contextMenu').css('top', y).css('left', x).show();
        $('body').one('click', () => {
            $('.contextMenu').hide();
        });
    }

    hide(): void {
        $('.contextMenu').hide();
    }

}

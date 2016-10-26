/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Output, EventEmitter } from '@angular/core';

import {ISlickRange} from './../slickgrid/SelectionModel';

import * as Constants from './../constants';
import * as Utils from './../utils';
/**
 * The component that acts as the contextMenu for slick grid
 */

@Component({
    selector: 'context-menu',
    templateUrl: 'dist/html/contextmenu.component.html'
})

export class ContextMenu {
    // tslint:disable-next-line:no-unused-variable
    private Utils = Utils;
    // tslint:disable-next-line:no-unused-variable
    private Constants = Constants;

    @Output() clickEvent: EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>
        = new EventEmitter<{type: string, batchId: number, resultId: number, index: number, selection: ISlickRange[]}>();
    private batchId: number;
    private resultId: number;
    private index: number;
    private selection: ISlickRange[];
    private isDisabled: boolean;

    show(x: number, y: number, batchId: number, resultId: number, index: number, selection: ISlickRange[]): void {
        this.batchId = batchId;
        this.resultId = resultId;
        this.index = index;
        this.selection = selection;
        this.isDisabled = (selection.length > 1);
        $('.contextMenu').css('top', y).css('left', x).show();
        $('body').one('click', () => {
            $('.contextMenu').hide();
        });
    }

    hide(): void {
        $('.contextMenu').hide();
    }

    handleContextActionClick( type: string ): void {
        if (!this.isDisabled) {
            this.clickEvent.emit({'type': type, 'batchId': this.batchId, 'resultId': this.resultId, 'selection': this.selection, 'index': this.index});
        }
    }
}

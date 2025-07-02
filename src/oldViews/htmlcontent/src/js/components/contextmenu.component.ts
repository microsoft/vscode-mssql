/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Component, Output, EventEmitter, Inject, forwardRef, OnInit } from "@angular/core";
import { ISlickRange } from "../../../../../extension/models/interfaces";
import { ShortcutService } from "./../services/shortcuts.service";
import * as Constants from "./../constants";

export interface IContextMenuClickEventArgs {
    type: string;
    batchId: number;
    resultId: number;
    index: number;
    selection: ISlickRange[];
    source: "contextMenu" | "gridIcons";
}

/**
 * The component that acts as the contextMenu for slick grid
 */

const template = `
<ul class="contextMenu" style="position:absolute" [class.hidden]="!visible" [style.top.px]="position.y" [style.left.px]="position.x">
    <li id="savecsv" (click)="handleContextActionClick('savecsv')" [class.disabled]="isDisabled"> {{Constants.saveCSVLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.saveAsCSV']}}</span></li>
    <li id="savejson" (click)="handleContextActionClick('savejson')" [class.disabled]="isDisabled"> {{Constants.saveJSONLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.saveAsJSON']}}</span></li>
    <li id="saveexcel" (click)="handleContextActionClick('saveexcel')" [class.disabled]="isDisabled"> {{Constants.saveExcelLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.saveAsExcel']}}</span></li>
    <li id="selectall" (click)="handleContextActionClick('selectall')" [class.disabled]="isDisabled"> {{Constants.selectAll}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.selectAll']}}</span></li>
    <li id="copy" (click)="handleContextActionClick('copySelection')" [class.disabled]="isDisabled"> {{Constants.copyLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.copySelection']}}</span></li>
    <li id="copyWithHeaders" (click)="handleContextActionClick('copyWithHeaders')" [class.disabled]="isDisabled"> {{Constants.copyWithHeadersLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.copyWithHeaders']}}</span></li>
    <li id="copyAllHeaders" (click)="handleContextActionClick('copyAllHeaders')" [class.disabled]="isDisabled"> {{Constants.copyAllHeadersLabel}}
        <span style="float: right; color: lightgrey; padding-left: 10px">{{keys['event.copyAllHeaders']}}</span></li>
</ul>
`;

@Component({
    selector: "context-menu",
    providers: [ShortcutService],
    template: template,
})
export class ContextMenu implements OnInit {
    // tslint:disable-next-line:no-unused-variable
    public Constants = Constants;

    @Output() clickEvent: EventEmitter<IContextMenuClickEventArgs> =
        new EventEmitter<IContextMenuClickEventArgs>();
    private batchId: number;
    private resultId: number;
    private index: number;
    private selection: ISlickRange[];
    private isDisabled: boolean;
    public position: { x: number; y: number } = { x: 0, y: 0 };
    public visible: boolean = false;
    private keys = {
        "event.saveAsCSV": "",
        "event.saveAsJSON": "",
        "event.selectAll": "",
        "event.copySelection": "",
        "event.copyWithHeaders": "",
        "event.copyAllHeaders": "",
    };

    constructor(@Inject(forwardRef(() => ShortcutService)) private shortcuts: ShortcutService) {
        const self = this;
        for (let key in this.keys) {
            if (this.keys.hasOwnProperty(key)) {
                this.shortcuts.stringCodeFor(key).then((result) => {
                    self.keys[key] = result;
                });
            }
        }
    }

    ngOnInit(): void {
        const self = this;
        $(document).on("click", () => {
            self.hide();
        });
    }

    show(
        x: number,
        y: number,
        batchId: number,
        resultId: number,
        index: number,
        selection: ISlickRange[],
    ): void {
        this.batchId = batchId;
        this.resultId = resultId;
        this.index = index;
        this.selection = selection;
        this.position = { x: x, y: y };
        this.visible = true;
    }

    hide(): void {
        this.visible = false;
    }

    handleContextActionClick(type: string): void {
        if (!this.isDisabled) {
            this.clickEvent.emit({
                type: type,
                batchId: this.batchId,
                resultId: this.resultId,
                selection: this.selection,
                index: this.index,
                source: "contextMenu",
            });
        }
    }
}

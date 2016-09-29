/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Input, ContentChildren, ElementRef, forwardRef, Inject, OnInit, QueryList } from '@angular/core';
import { SlickGrid } from './slickgrid/SlickGrid';
import { IGridIcon } from './../interfaces';

enum SelectedTab {
    Results = 0,
    Messages = 1,
}

/**
 * Defines a Tab component which is the content of a tab on the page (to be used with the Tabs
 * component)
 */
@Component({
    selector: 'tab',
    styles: [`
        .pane{
        padding: 1em;
        }`],
    template: `
        <div class="boxRow header collapsible" [class.collapsed]="!active" (click)="active = !active">
            <span> {{title}} </span>
        </div>
        <div class="boxRow content vertBox scrollable" style="min-Height: 20%">
            <ng-content></ng-content>
        </div>`
})
export class Tab implements OnInit {
    @Input('tabTitle') title: string;
    @Input() id: SelectedTab;
    @Input() show: boolean;
    @Input() icons: IGridIcon[];
    @ContentChildren(SlickGrid) slickgrids: QueryList<SlickGrid>;

    private _active = true;

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {};

    ngOnInit(): void {
        this.updateActive();
    }

    private updateActive(): void {
        if (!this._active) {
            this._el.nativeElement.getElementsByClassName('content')[0].className += ' hidden';
        } else {
            this._el.nativeElement.getElementsByClassName('content')[0].className =
                this._el.nativeElement.getElementsByClassName('content')[0].className.replace( /(?:^|\s)hidden(?!\S)/g , '' );
        }
    }

    public set active(active: boolean) {
        this._active = active;
        this.updateActive();
    }

    public get active(): boolean {
        return this._active;
    }
}

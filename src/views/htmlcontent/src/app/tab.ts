/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Input, ContentChild, AfterContentChecked, AfterViewInit, ElementRef, forwardRef, Inject } from '@angular/core';
import { SlickGrid } from './slickgrid/SlickGrid';

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
        <div class="boxRow content box">
        <ng-content></ng-content>
        </div>`
})
export class Tab implements AfterContentChecked, AfterViewInit {
    @Input('tabTitle') title: string;
    @Input() id: SelectedTab;
    @Input() show: boolean;
    @ContentChild(SlickGrid) slickgrid: SlickGrid;

    private _active = false;

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {};

    private updateActive(): void {
        if (!this._active) {
            this._el.nativeElement.className += ' hidden';
        } else {
            this._el.nativeElement.className = this._el.nativeElement.className.replace( /(?:^|\s)hidden(?!\S)/g , '' );
        }
    }

    public set active(active: boolean) {
        this._active = active;
        this.updateActive();
    }

    public get active(): boolean {
        return this._active;
    }

    /**
     * Called by angular
     */
    ngAfterContentChecked(): void {
        if (this.slickgrid) {
            this.slickgrid.onResize();
        }
    }

    /**
     * Called by angular
     */
    ngAfterViewInit(): void {
        if (this.slickgrid) {
            this.slickgrid.onResize();
        }
    }
}

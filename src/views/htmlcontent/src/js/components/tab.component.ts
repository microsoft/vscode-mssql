/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Component, Input, ElementRef, forwardRef, Inject, EventEmitter, OnInit,
     Output } from '@angular/core';
import { Observable } from 'rxjs/RX';

import { IGridIcon } from './../interfaces';

enum SelectedTab {
    Results = 0,
    Messages = 1,
}

export class ScrollEvent {
    scrollTop: number;
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
        <ng-content></ng-content>`
})
export class Tab implements OnInit {
    @Input('tabTitle') title: string;
    @Input() id: SelectedTab;
    @Input() show: boolean;
    @Input() icons: IGridIcon[];
    @Output() onScroll: EventEmitter<ScrollEvent> = new EventEmitter<ScrollEvent>();

    private _active = true;

    constructor(@Inject(forwardRef(() => ElementRef)) private _el: ElementRef) {
        Observable.fromEvent(this._el.nativeElement, 'scroll').subscribe((event) => {
            this.onScroll.emit({
                scrollTop: this._el.nativeElement.scrollTop
            });
        });
    };

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

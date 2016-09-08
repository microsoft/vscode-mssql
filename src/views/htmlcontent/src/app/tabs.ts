import { Component, ContentChildren, QueryList, AfterContentInit, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { Tab } from './tab';
import { TabFilter } from './tab.filter';

enum SelectedTab {
    Results = 0,
    Messages = 1,
}

@Component({
    selector: 'tabs',
    pipes: [TabFilter],
    template: `
        <ul class="nav nav-tabs boxRow header">
            <li *ngFor="let tab of tabs | tabFilter" (click)="selectTab(tab)" [class.active]="tab._active">
                <a href="#">{{tab.title}}</a>
            </li>
        </ul>
        <ng-content></ng-content>`
})
export class Tabs implements AfterContentInit, OnChanges {
    @Input() selected: SelectedTab;
    @Output() tabChange: EventEmitter<SelectedTab> = new EventEmitter<SelectedTab>();
    @ContentChildren(Tab) tabs: QueryList<Tab>;

    ngOnChanges(changes: SimpleChanges) {
        if(changes['selected'] && this.tabs && this.selected) {
            let activeTabs = this.tabs.filter((tab) => tab.id === this.selected);
            this.tabs.toArray().forEach(tab => tab.active = false);
            activeTabs[0].active = true;
        }
    }

    // contentChildren are set
    ngAfterContentInit(): void {
        // get all active tabs
        let activeTabs = this.tabs.filter((tab) => tab.active);

        // if there is no active tab set, activate the first
        if (activeTabs.length === 0 && this.tabs.length > 0) {
            this.selectTab(this.tabs.first);
        }
    }

    selectTab(selectedTab: Tab): void {
        // deactivate all tabs
        this.tabChange.emit(selectedTab.id);
    }
}

import { Component, Input, OnChanges, ContentChild, AfterContentChecked, AfterViewInit } from '@angular/core';
import { SlickGrid } from './slickgrid/SlickGrid';

@Component({
  selector: 'tab',
  styles: [`
    .pane{
      padding: 1em;
    }
  `],
  template: `
    <div *ngIf="active" class="boxRow content box">
      <ng-content></ng-content>
    </div>
  `
})
export class Tab implements AfterContentChecked, AfterViewInit {
  @Input('tabTitle') title: string;
  @Input() active = false;
  @ContentChild(SlickGrid) slickgrid: SlickGrid;

  ngAfterContentChecked(): void {
    if (this.slickgrid) {
      this.slickgrid.onResize();
    }
  }

  ngAfterViewInit(): void {
    if (this.slickgrid) {
      this.slickgrid.onResize();
    }
  }
}

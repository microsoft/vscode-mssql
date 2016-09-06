import { Component, Input, OnChanges, ContentChild } from '@angular/core';
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
export class Tab implements OnChanges {
  @Input('tabTitle') title: string;
  @Input() active = false;
  @ContentChild(SlickGrid) slickgrid: SlickGrid;

  ngOnChanges(changes): void {
      console.log('changes');
  }

  ngOnInit(): void {
    console.log('init');
  }

  ngDoCheck(): void {
    console.log('check');
  }

  ngAfterContentInit(): void {
    console.log('content init');
  }

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

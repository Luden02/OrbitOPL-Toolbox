import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LogsPage } from './logs-page';

describe('LogsPage', () => {
  let component: LogsPage;
  let fixture: ComponentFixture<LogsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LogsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

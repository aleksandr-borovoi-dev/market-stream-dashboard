import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-action-button',
  templateUrl: './action-button.html',
  styleUrl: './action-button.scss',
})
export class ActionButton {
  readonly label = input.required<string>();
  readonly disabled = input(false);

  readonly pressed = output<void>();
}

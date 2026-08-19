/**
 * Tiny control rack for demo pages, so every effect exposes its knobs the same
 * way. Demo-only: effects must never import this.
 */

interface ControlBase {
  label: string;
}

export interface RangeControl extends ControlBase {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  value: number;
  /** Formats the readout; defaults to the raw value. */
  format?: (value: number) => string;
  onInput: (value: number) => void;
}

export interface ToggleControl extends ControlBase {
  kind: 'toggle';
  value: boolean;
  onInput: (value: boolean) => void;
}

export interface SelectControl extends ControlBase {
  kind: 'select';
  options: { label: string; value: string }[];
  value: string;
  onInput: (value: string) => void;
}

export interface ButtonControl extends ControlBase {
  kind: 'button';
  onInput: () => void;
}

/**
 * A collapsible sub-rack. Effects with a large knob count (the filmstock has
 * fifteen) overflow the fixed rack otherwise, and a reader hunting one control
 * should not have to scroll past every other one to reach it.
 */
export interface GroupControl extends ControlBase {
  kind: 'group';
  controls: Control[];
  /** Collapsed by default: a group only earns its space when the reader opens it. */
  open?: boolean;
}

export type Control =
  | RangeControl
  | ToggleControl
  | SelectControl
  | ButtonControl
  | GroupControl;

/**
 * Renders a collapsible rack of controls into `host` (expected to be a
 * `<details class="demo-controls">`). Replaces any previous content.
 */
export function createControls(host: HTMLElement, title: string, controls: Control[]): void {
  host.replaceChildren();

  if (host instanceof HTMLDetailsElement) {
    // The rack is fixed to the bottom-right corner at a flat 15.5rem (248px)
    // wide, and every demo's effect surface runs full-bleed behind it, so
    // there's no viewport width where it stops touching that surface outright.
    // What changes is how much of the screen it eats: measured at 375px it's
    // 66% of the viewport width (and ~41% of the viewport area once you factor
    // in its height) sitting right on top of the thing the reader came to see;
    // by 640px that's down to 39% width / ~20% area, a corner accessory rather
    // than a takeover. 640px (Tailwind's `sm`) is also the first widely-used
    // breakpoint past that drop, so default open above it and collapsed below.
    host.open = window.matchMedia('(min-width: 640px)').matches;
  }

  const summary = document.createElement('summary');
  summary.textContent = title;
  host.append(summary);

  for (const control of controls) host.append(buildControl(control));
}

function buildControl(control: Control): HTMLElement {
  if (control.kind === 'group') {
    const group = document.createElement('details');
    group.className = 'demo-control-group';
    group.open = control.open ?? false;
    const summary = document.createElement('summary');
    summary.textContent = control.label;
    group.append(summary);
    for (const child of control.controls) group.append(buildControl(child));
    return group;
  }

  const row = document.createElement('div');
  row.className = 'demo-control';

  if (control.kind === 'button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = control.label;
    button.addEventListener('click', () => control.onInput());
    row.append(button);
    return row;
  }

  const label = document.createElement('label');
  label.textContent = control.label;

  if (control.kind === 'range') {
    const input = document.createElement('input');
    const readout = document.createElement('output');
    const format = control.format ?? ((value: number) => String(value));
    input.type = 'range';
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(control.value);
    readout.textContent = format(control.value);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      readout.textContent = format(value);
      control.onInput(value);
    });
    label.htmlFor = input.id = uid();
    row.append(label, readout, input);
  } else if (control.kind === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = control.value;
    input.addEventListener('input', () => control.onInput(input.checked));
    label.htmlFor = input.id = uid();
    row.classList.add('is-toggle');
    row.append(input, label);
  } else {
    const select = document.createElement('select');
    for (const option of control.options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      select.append(el);
    }
    select.value = control.value;
    select.addEventListener('input', () => control.onInput(select.value));
    label.htmlFor = select.id = uid();
    row.append(label, select);
  }

  return row;
}

let seq = 0;
function uid(): string {
  return `ctl-${++seq}`;
}

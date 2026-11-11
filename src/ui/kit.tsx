// Small shared building blocks: toasts, dialogs, form fields.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { newId } from '../core/ids';
import { platform } from '../platform';

// ---------------------------------------------------------------------------
// Toasts: short messages at the bottom of the screen
// ---------------------------------------------------------------------------

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error' | 'success';
  /** Optional button, e.g. "Undo". */
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);

export function toast(text: string, opts: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}): void {
  const t: Toast = { id: newId(), text, kind: opts.kind ?? 'info', action: opts.action };
  toasts.value = [...toasts.value.slice(-3), t];
  const ms = opts.ms ?? (opts.action ? 8000 : opts.kind === 'error' ? 7000 : 3000);
  setTimeout(() => dismissToast(t.id), ms);
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function ToastHost() {
  return (
    // aria-live makes screen readers announce new messages.
    <div class="toast-host" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              class="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button class="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

interface DialogSpec {
  id: string;
  render: (close: (result?: unknown) => void) => ComponentChildren;
  resolve: (result: unknown) => void;
  /** If false, clicking outside or pressing Escape does not close it. */
  dismissable: boolean;
}

const dialogs = signal<DialogSpec[]>([]);

/** Open a dialog. Resolves with whatever is passed to `close`, or undefined if dismissed. */
export function openDialog<T>(render: (close: (result?: T) => void) => ComponentChildren, dismissable = true): Promise<T | undefined> {
  return new Promise((resolve) => {
    const spec: DialogSpec = {
      id: newId(),
      render: render as DialogSpec['render'],
      resolve: resolve as DialogSpec['resolve'],
      dismissable,
    };
    dialogs.value = [...dialogs.value, spec];
  });
}

function closeDialog(id: string, result?: unknown): void {
  const spec = dialogs.value.find((d) => d.id === id);
  if (!spec) return;
  dialogs.value = dialogs.value.filter((d) => d.id !== id);
  spec.resolve(result);
}

export function DialogHost() {
  return (
    <>
      {dialogs.value.map((d) => (
        <DialogFrame key={d.id} spec={d} />
      ))}
    </>
  );
}

function DialogFrame({ spec }: { spec: DialogSpec }) {
  const box = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);
  useEffect(() => {
    // Remember what had focus, move focus into the dialog, and put it back afterwards.
    lastFocus.current = document.activeElement;
    const first = box.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button, a[href]');
    first?.focus();
    return () => {
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && spec.dismissable) {
      e.stopPropagation();
      closeDialog(spec.id);
    }
    // Keep Tab inside the dialog.
    if (e.key === 'Tab' && box.current) {
      const items = [...box.current.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href], [tabindex]')].filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div
      class="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && spec.dismissable) closeDialog(spec.id);
      }}
      onKeyDown={onKey}
    >
      <div class="dialog" role="dialog" aria-modal="true" ref={box}>
        {spec.render((result) => closeDialog(spec.id, result))}
      </div>
    </div>
  );
}

/** A yes/no question. Resolves true only if the user picks the confirm button. */
export function confirmDialog(opts: {
  title: string;
  body?: ComponentChildren;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return openDialog<boolean>((close) => (
    <>
      <h2 class="dialog-title">{opts.title}</h2>
      {opts.body && <div class="dialog-body">{opts.body}</div>}
      <div class="dialog-actions">
        {/* Cancel comes first and gets focus, so pressing Enter by accident never does the risky thing. */}
        <button class="btn" autofocus onClick={() => close(false)}>
          {opts.cancel ?? 'Cancel'}
        </button>
        <button class={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
          {opts.confirm}
        </button>
      </div>
    </>
  )).then((r) => r === true);
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

/**
 * A labelled form control.
 *
 * The label wraps only the name and the control, so a screen reader announces
 * "Tournament, text box" and not the hint text as well. For a group of buttons
 * (e.g. Aff | Neg) pass `group`: a <label> would wrongly name just the first button.
 */
export function Field(props: { label: string; hint?: ComponentChildren; children: ComponentChildren; class?: string; group?: boolean }) {
  return (
    <div class={`field ${props.class ?? ''}`}>
      {props.group ? (
        <div class="field-inner" role="group" aria-label={props.label}>
          <span class="field-label">{props.label}</span>
          {props.children}
        </div>
      ) : (
        <label class="field-inner">
          <span class="field-label">{props.label}</span>
          {props.children}
        </label>
      )}
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </div>
  );
}

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'url' | 'password' | 'search' | 'email';
  placeholder?: string;
  disabled?: boolean;
  autofocus?: boolean;
  maxLength?: number;
  list?: string;
  id?: string;
  'aria-label'?: string;
  onFocus?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  const { value, onChange, type, ...rest } = props;
  // Preact's types tie some attributes to particular input types; a plain cast keeps this helper simple.
  const kind = (type ?? 'text') as 'text';
  return <input class="input" type={kind} {...rest} value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />;
}

export function TextArea(props: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  class?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <textarea
      class={`input textarea ${props.class ?? ''}`}
      rows={props.rows ?? 4}
      placeholder={props.placeholder}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      value={props.value}
      onInput={(e) => props.onChange((e.target as HTMLTextAreaElement).value)}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      class="input"
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      value={props.value}
      onChange={(e) => props.onChange((e.target as HTMLSelectElement).value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; hint?: ComponentChildren; disabled?: boolean }) {
  return (
    <div class={`toggle ${props.disabled ? 'is-disabled' : ''}`}>
      <label class="toggle-row">
        <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
        <span class="toggle-label">{props.label}</span>
      </label>
      {props.hint && <span class="field-hint toggle-hint">{props.hint}</span>}
    </div>
  );
}

/** Two or three choices shown as joined buttons, e.g. Aff | Neg. */
export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; class?: string }[];
  ariaLabel: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          class={`segmented-item ${props.value === o.value ? 'is-on' : ''} ${o.class ?? ''}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Keyboard key, for shortcut hints. */
export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}

/** A feature that this version of the app cannot do, shown clearly instead of hidden or broken. */
export function Unavailable({ children }: { children: ComponentChildren }) {
  return (
    <div class="unavailable" role="note">
      {children}
    </div>
  );
}

/** A link to another website. Opens in the normal browser, in both versions of the app. */
export function ExternalLink({ href, children }: { href: string; children: ComponentChildren }) {
  const ok = /^https?:\/\//i.test(href);
  if (!ok) return <span>{children}</span>;
  return (
    <a
      class="link"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        e.preventDefault();
        platform.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

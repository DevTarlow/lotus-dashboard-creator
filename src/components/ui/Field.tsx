import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition ' +
  'placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ' +
  'dark:focus:border-violet-500/60';

export interface FieldProps {
  label?: ReactNode;
  /** Helper text below the control. */
  help?: ReactNode;
  /** Validation message; switches the field to its error style. */
  error?: string;
  /** Rendered on the right of the label row. */
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + help text wrapper used by every form in the app. */
export function Field({ label, help, error, hint, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label
              htmlFor={htmlFor}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              {label}
            </label>
          ) : (
            <span />
          )}
          {hint ? <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span> : null}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
      ) : help ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{help}</p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Convenience: renders the field wrapper and wires up the ids. */
  label?: ReactNode;
  help?: ReactNode;
  error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, help, error, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const input = (
    <input
      ref={ref}
      id={inputId}
      className={cn(CONTROL, error && 'border-rose-400 focus:border-rose-400 focus:ring-rose-500/30', className)}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  if (!label && !help && !error) return input;
  return (
    <Field label={label} help={help} error={error} htmlFor={inputId}>
      {input}
    </Field>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  help?: ReactNode;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, help, error, className, id, rows = 4, ...rest },
  ref,
) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const area = (
    <textarea
      ref={ref}
      id={areaId}
      rows={rows}
      className={cn(CONTROL, 'resize-y leading-relaxed', error && 'border-rose-400', className)}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  if (!label && !help && !error) return area;
  return (
    <Field label={label} help={help} error={error} htmlFor={areaId}>
      {area}
    </Field>
  );
});

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  help?: ReactNode;
  options: ReadonlyArray<{ label: string; value: string }>;
}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { label, help, options, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const select = (
    <select ref={ref} id={selectId} className={cn(CONTROL, 'cursor-pointer pr-8', className)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  if (!label && !help) return select;
  return (
    <Field label={label} help={help} htmlFor={selectId}>
      {select}
    </Field>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Accessible toggle switch (native checkbox under the hood). */
export function Switch({ checked, onChange, label, help, disabled, id, className }: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {(label || help) && (
        <div className="flex flex-col">
          {label ? (
            <label htmlFor={switchId} className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
              {label}
            </label>
          ) : null}
          {help ? <span className="text-xs text-slate-500 dark:text-slate-400">{help}</span> : null}
        </div>
      )}
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-violet-600 dark:bg-violet-500' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

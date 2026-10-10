import { useMemo } from 'react';
import { Field, SelectInput, Switch, TextArea, TextInput } from '@/components/ui';
import { asBoolean, asNumber, asString } from '@/lib/utils';
import type { SettingField, WidgetConfig, WidgetDefinition } from '@/types';

export interface SettingControlProps {
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
}

/** Renders a single schema field. */
function SettingControl({ field, value, onChange }: SettingControlProps) {
  switch (field.type) {
    case 'text':
      return (
        <Field label={field.label} help={field.help} htmlFor={`setting-${field.key}`}>
          <TextInput
            id={`setting-${field.key}`}
            value={asString(value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'textarea':
      return (
        <Field label={field.label} help={field.help} htmlFor={`setting-${field.key}`}>
          <TextArea
            id={`setting-${field.key}`}
            value={asString(value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            rows={field.rows ?? 5}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'number':
      return (
        <Field
          label={field.label}
          help={field.help}
          hint={field.unit ? `in ${field.unit}` : undefined}
          htmlFor={`setting-${field.key}`}
        >
          <TextInput
            id={`setting-${field.key}`}
            type="number"
            value={String(asNumber(value, field.min ?? 0))}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(event) => {
              const next = Number(event.target.value);
              const clamped = Number.isFinite(next) ? next : (field.min ?? 0);
              onChange(field.min !== undefined || field.max !== undefined
                ? Math.min(Math.max(clamped, field.min ?? clamped), field.max ?? clamped)
                : clamped);
            }}
          />
        </Field>
      );

    case 'switch':
      return (
        <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700/70">
          <Switch
            checked={asBoolean(value, false)}
            onChange={onChange}
            label={field.label}
            help={field.help}
            id={`setting-${field.key}`}
          />
        </div>
      );

    case 'select':
      return (
        <SelectInput
          label={field.label}
          help={field.help}
          options={field.options}
          value={asString(value, field.options[0]?.value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    default:
      return null;
  }
}

export interface SettingsFormProps {
  definition: WidgetDefinition;
  config: WidgetConfig;
  /** Receives a patch object, e.g. `{ hour12: true }`. */
  onChange: (patch: WidgetConfig) => void;
}

/**
 * Schema driven settings form.
 *
 * Widgets declare their settings as data (see `SettingField`), which means a new
 * widget gets a working settings UI without writing a single form control.
 */
export function SettingsForm({ definition, config, onChange }: SettingsFormProps) {
  const fields = useMemo(() => definition.settings ?? [], [definition]);

  if (fields.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        This widget has no settings — its content is edited directly on the canvas.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <SettingControl
          key={field.key}
          field={field}
          value={config[field.key]}
          onChange={(value) => onChange({ [field.key]: value })}
        />
      ))}
    </div>
  );
}

/**
 * Widget plugin contracts.
 *
 * A widget is a *definition* (metadata + defaults + React component) registered
 * once in the widget registry. Every time a user spawns one, a `WidgetInstance`
 * (a serialisable record) is created. Rendering an instance means looking up its
 * definition and hydrating it with the instance's config.
 */
import type { ComponentType } from 'react';
import type { WidgetSize } from './layout';

/** Icon components only need to accept a class name. */
export interface IconProps {
  className?: string;
}

/** Free-form, serialisable configuration object. */
export type WidgetConfig = Record<string, unknown>;

/** Used purely for grouping widgets inside the "Add widget" drawer. */
export type WidgetCategory = 'essentials' | 'productivity' | 'markets' | 'news' | 'utilities';

/** Accent tone used for icon chips and previews. */
export type AccentTone = 'violet' | 'sky' | 'amber' | 'emerald' | 'rose' | 'slate';

/**
 * Declarative settings schema. The settings modal renders these fields
 * generically, so a widget author never has to write form markup.
 */
interface SettingFieldBase {
  /** Key inside the widget config object. */
  key: string;
  /** Human readable label. */
  label: string;
  /** Optional helper text rendered underneath the control. */
  help?: string;
}

export interface SettingTextField extends SettingFieldBase {
  type: 'text';
  placeholder?: string;
  maxLength?: number;
}

/**
 * A secret held in app preferences rather than widget config.
 *
 * `key` names a field on the preferences store (e.g. `finnhubKey`), so the value
 * is entered once and shared by every widget instead of per instance.
 */
export interface SettingPasswordField extends SettingFieldBase {
  type: 'password';
  placeholder?: string;
  maxLength?: number;
  /** Optional `https:` link rendered under the control, e.g. a signup page. */
  link?: { href: string; label: string };
}

export interface SettingTextareaField extends SettingFieldBase {
  type: 'textarea';
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}

export interface SettingNumberField extends SettingFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit suffix, e.g. "min" or "%". */
  unit?: string;
}

export interface SettingSwitchField extends SettingFieldBase {
  type: 'switch';
}

export interface SettingSelectField extends SettingFieldBase {
  type: 'select';
  options: ReadonlyArray<{ label: string; value: string }>;
}

export type SettingField =
  | SettingTextField
  | SettingTextareaField
  | SettingNumberField
  | SettingSwitchField
  | SettingSelectField
  | SettingPasswordField;

/** A serialisable widget on the dashboard. */
export interface WidgetInstance<C extends object = WidgetConfig> {
  /** Stable unique id, also used as the grid layout item key. */
  id: string;
  /** Registry key of the widget definition that renders this instance. */
  type: string;
  /** User editable title shown in the widget header. */
  title: string;
  /** Widget specific configuration. */
  config: C;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
}

/** Widget instance as stored / exported (config erased to an index signature). */
export type StoredWidgetInstance = WidgetInstance<WidgetConfig>;

/** Props every widget component receives. */
export interface WidgetProps<C extends object = WidgetConfig> {
  /** The instance being rendered. */
  instance: WidgetInstance<C>;
  /** Convenience alias for `instance.config`. */
  config: C;
  /** Merge a partial config update into the instance (persisted immediately). */
  updateConfig: (patch: Partial<C>) => void;
  /** Replace the whole config object. */
  replaceConfig: (next: C) => void;
  /** Rename the instance. */
  setTitle: (title: string) => void;
}

/** The component signature stored in the registry. */
export type WidgetComponent<C extends object = WidgetConfig> = ComponentType<WidgetProps<C>>;

/**
 * A widget plugin. Registering a new widget is a single object literal, which is
 * what makes the architecture pluggable.
 */
export interface WidgetDefinition<C extends object = WidgetConfig> {
  /** Unique registry key, e.g. `clock`. Also persisted in exports. */
  type: string;
  /** Display name. */
  name: string;
  /** One line description shown in the drawer. */
  summary: string;
  /** Drawer grouping. */
  category: WidgetCategory;
  /** Extra search terms for the drawer filter. */
  keywords?: readonly string[];
  /** Small icon component. */
  icon: ComponentType<IconProps>;
  /** Accent colour used for the icon chip. */
  accent: AccentTone;
  /** Default footprint on the 12 column grid. */
  defaultSize: WidgetSize;
  /** Default config for new instances. */
  defaultConfig: C;
  /** Optional schema driven settings form. */
  settings?: readonly SettingField[];
  /** Optional badge shown in the drawer (e.g. "Live"). */
  badge?: string;
  /** Optional one line description of the current config, shown in the header. */
  summarize?: (config: C) => string | undefined;
  /** The React component rendering this widget. */
  component: WidgetComponent<C>;
}

/**
 * Registry-aware validation hooks.
 *
 * Shared by the persistence layer (rehydration) and the import dialog so both
 * use exactly the same rules.
 */
import { GRID_COLUMNS } from '@/constants/grid';
import type { ValidateOptions } from '@/lib/validation';
import { getWidgetDefinition, isKnownWidgetType } from './registry';

export const registryValidationOptions: ValidateOptions = {
  isKnownType: isKnownWidgetType,
  defaultConfigFor: (type) => getWidgetDefinition(type)?.defaultConfig,
  displayNameFor: (type) => getWidgetDefinition(type)?.name,
  columns: GRID_COLUMNS,
};

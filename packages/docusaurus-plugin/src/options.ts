import { Joi } from '@docusaurus/utils-validation';
import type { ThemeConfigValidationContext } from '@docusaurus/types';
import {
  DEFAULT_THEME_CONFIG,
  PALETTE_OPTIONS,
  TOOLBAR_ITEMS,
  type ThemeConfig,
} from './defaults.js';

export {
  DEFAULT_EDITOR_URL,
  DEFAULT_THEME_CONFIG,
  PALETTE_OPTIONS,
  TOOLBAR_ITEMS,
  type DbmlPalette,
  type DbmlThemeConfig,
  type ThemeConfig,
} from './defaults.js';

export const ThemeConfigSchema = Joi.object<ThemeConfig>({
  dbml: Joi.object({
    height: Joi.alternatives()
      .try(Joi.number().positive(), Joi.string().min(1))
      .default(DEFAULT_THEME_CONFIG.dbml.height),
    toolbar: Joi.array()
      .items(Joi.string().valid(...TOOLBAR_ITEMS))
      .unique()
      .default(DEFAULT_THEME_CONFIG.dbml.toolbar),
    editorUrl: Joi.alternatives()
      .try(Joi.string().uri({ allowRelative: true }), Joi.boolean().valid(false))
      .default(DEFAULT_THEME_CONFIG.dbml.editorUrl),
    detailLevel: Joi.string()
      .valid('all', 'keys', 'names')
      .default(DEFAULT_THEME_CONFIG.dbml.detailLevel),
    palette: Joi.string()
      .valid(...PALETTE_OPTIONS)
      .default(DEFAULT_THEME_CONFIG.dbml.palette),
    ssr: Joi.boolean().default(DEFAULT_THEME_CONFIG.dbml.ssr),
    frozen: Joi.boolean().default(DEFAULT_THEME_CONFIG.dbml.frozen),
  }).default(DEFAULT_THEME_CONFIG.dbml),
});

/**
 * Validates `themeConfig.dbml` and fills in defaults. Called by Docusaurus at startup.
 *
 * @param context - What Docusaurus passes: the raw `themeConfig` and its `validate` helper.
 */
export function validateThemeConfig({
  validate,
  themeConfig,
}: ThemeConfigValidationContext<ThemeConfig>): ThemeConfig {
  return validate(ThemeConfigSchema, themeConfig);
}

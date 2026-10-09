/**
 * The Genspark settings page, browser half: one-click model / reasoning
 * selection, rotating API keys, and the automatic prompt. It mounts the
 * `genspark` Remote namespace the Host plugin serves and registers the page
 * into the Plugins page's `plugins.item` slot while the Host serves the
 * `llm-genspark` namespace. It also offers Japanese as a UI language.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import gensparkRemote from '@deepseek-ai/dsh-llm-genspark/remote'
import { GensparkCard } from './GensparkCard.tsx'
import { GENSPARK_NS, GensparkPageController } from './controller.ts'
import { en, fill, ja, zh, type GensparkSettingsLocaleKey } from './locales.ts'

export type { GensparkCardFace, GensparkCardProps } from './GensparkCard.tsx'
export type { GensparkPageActions, GensparkPageState } from './controller.ts'
export type { GensparkSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Genspark settings page copy. */
    'settings.genspark': GensparkSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.genspark'

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'configForms']

/**
 * Mount the Genspark Remote and the settings page.
 * @param ctx - the browser plugin context.
 * @returns disposer withdrawing the page, then the Remote.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(gensparkRemote)
  const ui = ctx.inject(['remote.genspark', ...inject], (child) => {
    const t = child.locale.bind(NS)
    // Offer Japanese as a UI language; English fills keys other packages do
    // not translate. Another plugin may have added it already.
    child.effect(() => {
      try { return child.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }) } catch { return () => {} }
    }, 'ui-settings-genspark: Japanese language')
    child.effect(() => child.locale.register(NS, { zh, en }), 'ui-settings-genspark: dictionaries')
    child.effect(() => child.locale.register(NS, 'ja', ja), 'ui-settings-genspark: Japanese dictionary')
    const page = new GensparkPageController(child, {
      added: (stored, duplicates, skipped) => fill(t('keysAdded'), { stored, duplicates, skipped }),
      keysFailed: () => t('keysFailed'),
      saved: () => t('saved'),
      saveFailed: () => t('saveFailed'),
    })
    child.effect(() => () => { page.dispose() }, 'ui-settings-genspark: controller')
    child.effect(() => child.configForms.whileServed([GENSPARK_NS], () => child.slots.inject('plugins.item', () => child.slots.register({
      name: 'plugins.item',
      id: 'genspark',
      // Ahead of every other official page: this is the page users open first.
      order: 1,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ hooks: { gensparkPage: page.store }, ...page.actions() }),
    }, GensparkCard))), 'ui-settings-genspark: page')
  })
  try { await ui } catch (error) { await ui.dispose(); await unmountRemote(); throw error }
  return async () => { await ui.dispose(); await unmountRemote() }
}

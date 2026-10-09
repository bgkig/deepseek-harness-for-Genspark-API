/**
 * The Genspark settings page: one-click model and reasoning-level selection,
 * rotating API keys, and the automatic prompt.
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, Checkbox, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GensparkPageActions, GensparkPageState } from './controller.ts'
import { REASONING_LEVELS } from './controller.ts'
import { fill } from './locales.ts'
import css from './GensparkCard.module.css'

/** Face the slot registration injects. */
export interface GensparkCardFace extends GensparkPageActions {
  hooks: { gensparkPage: SnapshotStore<GensparkPageState> }
}

/** Props the renderer binds. */
export type GensparkCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.genspark'>
  & InjectFace<GensparkCardFace>

const LEVEL_NAMES: Record<string, string> = {
  off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max',
}

/**
 * Render the one-liner or the full page.
 * @param props - view, copy, snapshot, and actions.
 * @returns the page.
 */
export function GensparkCard(props: GensparkCardProps) {
  const { t } = props
  const state = props.useGensparkPage(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  if (!state.available) return <p className={css.notice}>{t('unavailable')}</p>
  const disabled = !state.writable
  const { keys, model, auto } = state
  const visibleSlots = keys.showAll ? keys.slots : keys.slots.filter(slot => slot.configured)
  const selectedModel = model.models.find(entry => entry.id === model.selected)
  const efforts = (selectedModel?.reasoning ?? []).filter(level => (REASONING_LEVELS as readonly string[]).includes(level))
  const proxyExtra = model.proxyModels?.filter(id => !model.models.some(entry => entry.id === id)) ?? []

  return (
    <div className={css.page}>
      {disabled ? <p className={css.notice}>{t('readOnly')}</p> : null}

      <section className={css.section} aria-labelledby="genspark-model-heading">
        <h3 id="genspark-model-heading" className={css.heading}>{t('modelHeading')}</h3>
        <p className={css.hint}>{t('modelHint')}</p>
        <div className={css.label}>{t('modelDefault')}</div>
        <div className={css.chips} role="radiogroup" aria-label={t('modelDefault')}>
          {model.models.map(entry => (
            <button key={entry.id} type="button" role="radio" aria-checked={entry.id === model.selected}
              className={entry.id === model.selected ? `${css.chip} ${css.chipOn}` : css.chip}
              disabled={disabled || model.busy}
              onClick={() => { props.selectModel(entry.id) }}>
              {entry.name !== undefined && entry.name.length > 0 ? entry.name : entry.id}
            </button>
          ))}
        </div>
        <div className={css.label}>{t('modelEffort')}</div>
        {efforts.length === 0
          ? <p className={css.hint}>{t('modelEffortNone')}</p>
          : (
            <div className={css.chips} role="radiogroup" aria-label={t('modelEffort')}>
              {efforts.map(level => (
                <button key={level} type="button" role="radio" aria-checked={level === model.effort}
                  className={level === model.effort ? `${css.chip} ${css.chipOn}` : css.chip}
                  disabled={disabled || model.busy}
                  onClick={() => { props.selectEffort(level) }}>
                  {LEVEL_NAMES[level] ?? level}
                </button>
              ))}
            </div>
          )}
        <details className={css.more}>
          <summary>{t('modelProxyList')}</summary>
          {model.proxyModels === undefined
            ? <Button size="sm" variant="outline" onClick={props.loadProxyModels}>{t('modelProxyLoad')}</Button>
            : (
              <div className={css.chips}>
                {proxyExtra.map(id => (
                  <button key={id} type="button" className={css.chip} disabled={disabled}
                    onClick={() => { props.addProxyModel(id) }}>
                    + {id}
                  </button>
                ))}
              </div>
            )}
          {model.proxyFailed ? <p className={css.error}>{t('modelProxyFailed')}</p> : null}
        </details>
      </section>

      <section className={css.section} aria-labelledby="genspark-keys-heading">
        <h3 id="genspark-keys-heading" className={css.heading}>{t('keysHeading')}</h3>
        <p className={css.hint}>{t('keysHint')}</p>
        <p className={css.status}>
          {keys.configured === 0 ? t('keysNone') : fill(t('keysCount'), { count: keys.configured })}
          {keys.activeSlot === undefined ? null : <> · <strong>{fill(t('keysActive'), { slot: keys.activeSlot })}</strong></>}
        </p>
        {keys.lastRotation === undefined
          ? null
          : (
            <p className={css.hint}>
              {fill(t('keysLastRotation'), { from: keys.lastRotation.from, to: keys.lastRotation.to, reason: keys.lastRotation.reason })}
              {keys.lastRotation.wrapped ? ` — ${t('keysWrapped')}` : ''}
            </p>
          )}
        <textarea className={`${css.textarea} ${css.mono}`} rows={4} spellCheck={false} autoComplete="off"
          placeholder={t('keysPastePlaceholder')} value={keys.draft} disabled={keys.busy}
          aria-label={t('keysHeading')}
          onChange={(event) => { props.editKeys(event.target.value) }} />
        <div className={css.row}>
          <Button size="sm" variant="primary" disabled={keys.busy || keys.draft.trim().length === 0}
            onClick={() => { props.importKeys(false) }}>
            {t('keysAdd')}
          </Button>
          <Button size="sm" variant="outline" disabled={keys.busy || keys.draft.trim().length === 0}
            onClick={() => { if (window.confirm(t('keysReplaceConfirm'))) props.importKeys(true) }}>
            {t('keysReplace')}
          </Button>
          {keys.message === undefined
            ? null
            : <span className={keys.message.kind === 'ok' ? css.ok : css.error}>{keys.message.text}</span>}
        </div>
        <ul className={css.slots}>
          {visibleSlots.map(slot => (
            <li key={slot.slot} className={slot.active ? `${css.slot} ${css.slotActive}` : css.slot}>
              <span className={css.slotNumber}>#{slot.slot}</span>
              <span className={css.slotKey}>
                {slot.configured ? `••••${slot.hint ?? ''}` : t('keysEmptySlot')}
                {slot.active ? <em className={css.badge}>{t('keysInUse')}</em> : null}
              </span>
              {slot.configured && !slot.active
                ? <Button size="sm" variant="ghost" onClick={() => { props.selectSlot(slot.slot) }}>{t('keysUseNow')}</Button>
                : null}
              {slot.configured
                ? <Button size="sm" variant="ghost" onClick={() => { props.removeSlot(slot.slot) }}>{t('keysRemove')}</Button>
                : null}
            </li>
          ))}
        </ul>
        <div>
          <Button size="sm" variant="ghost" onClick={props.toggleShowAll}>
            {keys.showAll ? t('keysHideEmpty') : t('keysShowAll')}
          </Button>
        </div>
      </section>

      <section className={css.section} aria-labelledby="genspark-auto-heading">
        <h3 id="genspark-auto-heading" className={css.heading}>{t('autoHeading')}</h3>
        <p className={css.hint}>{t('autoHint')}</p>
        <div className={css.switchRow}>
          <span>{t('autoEnabled')}</span>
          <Switch checked={auto.value.enabled} label={t('autoEnabled')} disabled={disabled}
            onChange={(next) => { props.setAutoFlag('enabled', next) }} />
        </div>
        <div className={css.checks}>
          <Checkbox checked={auto.value.onCompleted} label={t('autoOnCompleted')} disabled={disabled}
            onChange={(next) => { props.setAutoFlag('onCompleted', next) }} />
          <Checkbox checked={auto.value.onError} label={t('autoOnError')} disabled={disabled}
            onChange={(next) => { props.setAutoFlag('onError', next) }} />
          <Checkbox checked={auto.value.onUserStop} label={t('autoOnUserStop')} disabled={disabled}
            onChange={(next) => { props.setAutoFlag('onUserStop', next) }} />
          <Checkbox checked={auto.value.includeSubagents} label={t('autoSubagents')} disabled={disabled}
            onChange={(next) => { props.setAutoFlag('includeSubagents', next) }} />
        </div>
        <label className={css.label} htmlFor="genspark-auto-prompt">{t('autoPrompt')}</label>
        <textarea id="genspark-auto-prompt" className={css.textarea} rows={3} disabled={disabled}
          value={auto.draft.completedPrompt}
          onChange={(event) => { props.editAuto('completedPrompt', event.target.value) }} />
        <label className={css.label} htmlFor="genspark-auto-error-prompt">{t('autoErrorPrompt')}</label>
        <textarea id="genspark-auto-error-prompt" className={css.textarea} rows={2} disabled={disabled}
          value={auto.draft.errorPrompt} placeholder={t('autoErrorPromptHint')}
          onChange={(event) => { props.editAuto('errorPrompt', event.target.value) }} />
        <div className={css.grid}>
          <label className={css.label} htmlFor="genspark-auto-max">{t('autoMax')}</label>
          <input id="genspark-auto-max" className={css.input} inputMode="numeric" disabled={disabled}
            value={auto.draft.maxConsecutive}
            onChange={(event) => { props.editAuto('maxConsecutive', event.target.value) }} />
          <label className={css.label} htmlFor="genspark-auto-delay">{t('autoDelay')}</label>
          <input id="genspark-auto-delay" className={css.input} inputMode="decimal" disabled={disabled}
            value={auto.draft.delaySeconds}
            onChange={(event) => { props.editAuto('delaySeconds', event.target.value) }} />
        </div>
        <p className={css.hint}>{t('autoMaxHint')}</p>
        <div className={css.row}>
          <Button size="sm" variant="primary" disabled={disabled || auto.busy || !auto.dirty} onClick={props.saveAuto}>
            {auto.busy ? t('saving') : t('save')}
          </Button>
          {auto.message === undefined
            ? null
            : <span className={auto.message.kind === 'ok' ? css.ok : css.error}>{auto.message.text}</span>}
        </div>
      </section>
    </div>
  )
}

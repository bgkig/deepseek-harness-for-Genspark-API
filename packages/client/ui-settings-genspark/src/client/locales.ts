/** Locale bundles for the Genspark settings page (English, Japanese, Simplified Chinese). */

/** Locale keys the page renders. */
export type GensparkSettingsLocaleKey =
  | 'title' | 'description' | 'unavailable' | 'readOnly'
  | 'keysHeading' | 'keysHint' | 'keysCount' | 'keysActive' | 'keysNone' | 'keysPastePlaceholder'
  | 'keysAdd' | 'keysReplace' | 'keysReplaceConfirm' | 'keysAdded' | 'keysUseNow' | 'keysRemove' | 'keysInUse'
  | 'keysShowAll' | 'keysHideEmpty' | 'keysEmptySlot' | 'keysLastRotation' | 'keysWrapped' | 'keysFailed'
  | 'modelHeading' | 'modelHint' | 'modelDefault' | 'modelEffort' | 'modelEffortNone'
  | 'modelProxyList' | 'modelProxyLoad' | 'modelProxyFailed'
  | 'autoHeading' | 'autoHint' | 'autoEnabled' | 'autoOnCompleted' | 'autoOnError' | 'autoOnUserStop'
  | 'autoPrompt' | 'autoErrorPrompt' | 'autoErrorPromptHint' | 'autoMax' | 'autoMaxHint' | 'autoDelay'
  | 'autoSubagents' | 'save' | 'saving' | 'saved' | 'saveFailed'

/** English copy. */
export const en: Record<GensparkSettingsLocaleKey, string> = {
  title: 'Genspark',
  description: 'API keys (up to 100, rotating), model and reasoning level, and the automatic prompt.',
  unavailable: 'The Genspark plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  keysHeading: 'API keys',
  keysHint: 'Paste one key per line (commas or spaces also work). When the key in use runs out, the next key is used immediately; after the last key, key 1 is used again. Keys are stored outside the settings file.',
  keysCount: '{count} / 100 keys configured',
  keysActive: 'In use: key {slot}',
  keysNone: 'No key configured yet.',
  keysPastePlaceholder: 'gsk-…\ngsk-…',
  keysAdd: 'Add keys',
  keysReplace: 'Replace all',
  keysReplaceConfirm: 'Remove every stored key and store only the pasted ones?',
  keysAdded: '{stored} added, {duplicates} already present, {skipped} did not fit.',
  keysUseNow: 'Use now',
  keysRemove: 'Remove',
  keysInUse: 'in use',
  keysShowAll: 'Show all 100 slots',
  keysHideEmpty: 'Hide empty slots',
  keysEmptySlot: 'empty',
  keysLastRotation: 'Last switch: key {from} → key {to} ({reason})',
  keysWrapped: 'returned to key 1',
  keysFailed: 'The keys could not be saved.',
  modelHeading: 'Model and reasoning',
  modelHint: 'One click applies it to new conversations and to the next message of the current one. The composer model button switches it per conversation too.',
  modelDefault: 'Model',
  modelEffort: 'Reasoning level',
  modelEffortNone: 'This model has no reasoning control.',
  modelProxyList: 'More models served by Genspark',
  modelProxyLoad: 'Load list',
  modelProxyFailed: 'Could not load the model list (is a key configured?).',
  autoHeading: 'Automatic prompt',
  autoHint: 'When work stops, send the prompt below automatically. Off by default.',
  autoEnabled: 'Send automatically when work stops',
  autoOnCompleted: 'When a task completes',
  autoOnError: 'When an error stops the work',
  autoOnUserStop: 'When I press Stop',
  autoPrompt: 'Prompt',
  autoErrorPrompt: 'Prompt after an error',
  autoErrorPromptHint: 'Leave blank to send the prompt above.',
  autoMax: 'Maximum in a row',
  autoMaxHint: 'Stops after this many automatic prompts without a message from you; 0 = unlimited.',
  autoDelay: 'Delay before sending (seconds)',
  autoSubagents: 'Also for subagents',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  saveFailed: 'The deployment did not accept these values.',
}

/** Japanese copy. */
export const ja: Record<GensparkSettingsLocaleKey, string> = {
  title: 'Genspark',
  description: 'APIキー（最大100個・自動切替）、AIモデルと推論レベル、自動プロンプト。',
  unavailable: 'Genspark プラグインが読み込まれていないため、現在は設定できません。',
  readOnly: 'このデプロイの設定は読み取り専用です。',
  keysHeading: 'APIキー',
  keysHint: '1行に1つずつ貼り付けてください（カンマ・空白区切りも可）。使用中のキーを使い切ると即座に次のキーへ切り替わり、最後のキーの次は1個目に戻ります。キーは設定ファイルとは別の場所に保存されます。',
  keysCount: '{count} / 100 個のキーを設定済み',
  keysActive: '使用中: {slot} 番目のキー',
  keysNone: 'まだキーが設定されていません。',
  keysPastePlaceholder: 'gsk-…\ngsk-…',
  keysAdd: 'キーを追加',
  keysReplace: 'すべて置き換え',
  keysReplaceConfirm: '保存済みのキーをすべて削除し、貼り付けたキーだけを保存しますか？',
  keysAdded: '{stored} 個追加、{duplicates} 個は登録済み、{skipped} 個は空き枠不足。',
  keysUseNow: '今すぐ使う',
  keysRemove: '削除',
  keysInUse: '使用中',
  keysShowAll: '100枠すべて表示',
  keysHideEmpty: '空き枠を隠す',
  keysEmptySlot: '空き',
  keysLastRotation: '直近の切替: {from} 番 → {to} 番（{reason}）',
  keysWrapped: '1番目に戻りました',
  keysFailed: 'キーを保存できませんでした。',
  modelHeading: 'AIモデルと推論レベル',
  modelHint: 'クリック1回で、新しい会話と現在の会話の次のメッセージから適用されます。入力欄のモデルボタンでも会話ごとに切り替えられます。',
  modelDefault: 'モデル',
  modelEffort: '推論レベル',
  modelEffortNone: 'このモデルには推論レベルの設定がありません。',
  modelProxyList: 'Genspark が提供するその他のモデル',
  modelProxyLoad: '一覧を取得',
  modelProxyFailed: 'モデル一覧を取得できませんでした（キーは設定されていますか？）。',
  autoHeading: '自動プロンプト',
  autoHint: '作業が停止したとき、下のプロンプトを自動で送信します。既定はオフです。',
  autoEnabled: '作業停止時に自動送信する',
  autoOnCompleted: '作業が完了したとき',
  autoOnError: 'エラーで停止したとき',
  autoOnUserStop: '自分で停止ボタンを押したとき',
  autoPrompt: 'プロンプト',
  autoErrorPrompt: 'エラー時のプロンプト',
  autoErrorPromptHint: '空欄なら上のプロンプトを送信します。',
  autoMax: '連続送信の上限',
  autoMaxHint: 'あなたのメッセージがないままこの回数送信すると止まります。0 = 無制限。',
  autoDelay: '送信までの待ち時間（秒）',
  autoSubagents: 'サブエージェントにも適用',
  save: '保存',
  saving: '保存中…',
  saved: '保存しました。',
  saveFailed: 'この値は受け付けられませんでした。',
}

/** Simplified Chinese copy. */
export const zh: Record<GensparkSettingsLocaleKey, string> = {
  title: 'Genspark',
  description: 'API Key（最多 100 个，自动轮换）、模型与推理强度、自动提示词。',
  unavailable: 'Genspark 插件未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  keysHeading: 'API Key',
  keysHint: '每行粘贴一个（也可用逗号或空格分隔）。当前 Key 用尽后立即切换到下一个；最后一个之后回到第 1 个。Key 不写入设置文件。',
  keysCount: '已配置 {count} / 100 个 Key',
  keysActive: '使用中：第 {slot} 个',
  keysNone: '尚未配置 Key。',
  keysPastePlaceholder: 'gsk-…\ngsk-…',
  keysAdd: '添加 Key',
  keysReplace: '全部替换',
  keysReplaceConfirm: '删除所有已保存的 Key，仅保存粘贴的 Key？',
  keysAdded: '新增 {stored} 个，已存在 {duplicates} 个，{skipped} 个没有空位。',
  keysUseNow: '立即使用',
  keysRemove: '删除',
  keysInUse: '使用中',
  keysShowAll: '显示全部 100 个位置',
  keysHideEmpty: '隐藏空位',
  keysEmptySlot: '空',
  keysLastRotation: '最近切换：第 {from} 个 → 第 {to} 个（{reason}）',
  keysWrapped: '已回到第 1 个',
  keysFailed: '无法保存 Key。',
  modelHeading: '模型与推理强度',
  modelHint: '点击一次即对新对话及当前对话的下一条消息生效。也可在输入框的模型按钮中按对话切换。',
  modelDefault: '模型',
  modelEffort: '推理强度',
  modelEffortNone: '该模型没有推理强度设置。',
  modelProxyList: 'Genspark 提供的更多模型',
  modelProxyLoad: '获取列表',
  modelProxyFailed: '无法获取模型列表（是否已配置 Key？）。',
  autoHeading: '自动提示词',
  autoHint: '工作停止时自动发送下面的提示词。默认关闭。',
  autoEnabled: '工作停止时自动发送',
  autoOnCompleted: '任务完成时',
  autoOnError: '因错误停止时',
  autoOnUserStop: '我按下停止时',
  autoPrompt: '提示词',
  autoErrorPrompt: '出错后的提示词',
  autoErrorPromptHint: '留空则发送上面的提示词。',
  autoMax: '连续发送上限',
  autoMaxHint: '在你没有发消息的情况下自动发送达到此次数后停止；0 = 不限。',
  autoDelay: '发送前等待（秒）',
  autoSubagents: '也应用于子代理',
  save: '保存',
  saving: '保存中…',
  saved: '已保存。',
  saveFailed: '本部署没有接受这些值。',
}

/**
 * Fill `{name}` placeholders.
 * @param template - localized text.
 * @param values - replacements.
 * @returns the filled text.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match)
}

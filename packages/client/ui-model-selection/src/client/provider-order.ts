/** Shared provider display order for the composer and command model pickers. */

/**
 * Put Genspark, then the account and official providers first, preserving every other relative order.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) => providerRank(left.id) - providerRank(right.id))
}

/** Genspark first, then the DeepSeek account and official routes, then everything else. */
function providerRank(id: string): number {
  if (id === 'genspark') return 0
  if (id === 'deepseek-account') return 1
  if (id === 'deepseek-official') return 2
  return 3
}

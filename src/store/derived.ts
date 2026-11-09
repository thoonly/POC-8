/**
 * Everything derived from the originating prompt (document, chat, later the graph and ledger)
 * registers a reset here. The Entry store calls resetDerived() when a new prompt becomes the basis,
 * so it never has to import the slices that depend on it (that would be an import cycle).
 */
const resets = new Set<() => void>();

export const onNewBasis = (fn: () => void): void => { resets.add(fn); };
export const resetDerived = (): void => { resets.forEach((fn) => fn()); };

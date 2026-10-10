// Small remembered choices (the last category used for each direction).
// Kept in secure storage like the sign-in; losing them only costs a tap.
import * as SecureStore from 'expo-secure-store';

import type { Kind } from './types';

const key = (kind: Kind) => `paylog.lastCategory.${kind}`;
const memory: Partial<Record<Kind, string>> = {};

export async function loadLastCategories() {
  for (const kind of ['expense', 'income'] as Kind[]) {
    try {
      const value = await SecureStore.getItemAsync(key(kind));
      if (value) memory[kind] = value;
    } catch {
      // Unreadable storage: fall back to the default category.
    }
  }
}

export function lastCategory(kind: Kind) {
  return memory[kind];
}

export function rememberCategory(kind: Kind, category: string) {
  if (memory[kind] === category) return;
  memory[kind] = category;
  SecureStore.setItemAsync(key(kind), category).catch(() => {});
}

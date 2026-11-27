import { describe, expect, it } from 'vitest';
import { persistRecipesVerified } from '../src/poc/q04/persistence';
import { createEditState, recipeFromEditState } from '../src/poc/q04/editState';
import type { CustomRecipe } from '../src/types/film';

const recipe = (id: string, updatedAt = 1): CustomRecipe => {
  const saved = recipeFromEditState(createEditState(), { id, name: id, createdAt: updatedAt, updatedAt });
  return { ...saved, updatedAt };
};

describe('Q04 verified recipe persistence', () => {
  it('reports success only after the stored list contains every recipe', async () => {
    const store: CustomRecipe[] = [recipe('a')];
    const deps = {
      persist: async (next: CustomRecipe[]) => { store.splice(0, store.length, ...next); },
      load: async () => store,
    };
    expect(await persistRecipesVerified([recipe('a'), recipe('b')], deps)).toEqual({ ok: true, expected: 2, actual: 2 });
  });

  it('surfaces a silent persist failure through the read-back comparison', async () => {
    const deps = { persist: async () => {}, load: async () => [recipe('a')] };
    const report = await persistRecipesVerified([recipe('a'), recipe('b')], deps);
    expect(report).toMatchObject({ ok: false, expected: 2, actual: 1 });
    expect(report.error).toContain('b');
  });

  it('turns a thrown persist error into a report instead of swallowing it', async () => {
    const deps = { persist: async () => { throw new Error('QuotaExceededError'); }, load: async () => [] };
    expect(await persistRecipesVerified([recipe('a')], deps)).toEqual({ ok: false, expected: 1, actual: 0, error: 'QuotaExceededError' });
  });
});

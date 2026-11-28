import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DevelopPanel } from '../src/components/raw/DevelopPanel';
import {
  RAW_NEUTRAL_DEVELOP,
  isNeutralDevelop,
  normalizeDevelop,
  type RawDevelopState,
} from '../src/engine/contracts/develop';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const AS_SHOT = { temperatureK: 5200, tint: 0 };

describe('develop state normalisation (contract)', () => {
  it('clamps and sanitises every field', () => {
    const normalized = normalizeDevelop({
      wb: { mode: 'custom', temperatureK: 99999, tint: -500 },
      exposureEV: 9,
      highlightRecovery: 7,
    });
    expect(normalized).toEqual({
      wb: { mode: 'custom', temperatureK: 12000, tint: -100 },
      exposureEV: 5,
      highlightRecovery: 1,
    });
    expect(normalizeDevelop({ exposureEV: Number.NaN }).exposureEV).toBe(0);
    expect(normalizeDevelop({ wb: { mode: 'bogus' } as any }).wb).toEqual({ mode: 'as-shot' });
  });

  it('identity is as-shot with zero exposure and recovery', () => {
    expect(isNeutralDevelop(RAW_NEUTRAL_DEVELOP)).toBe(true);
    expect(isNeutralDevelop({ ...RAW_NEUTRAL_DEVELOP, exposureEV: 0.5 })).toBe(false);
    expect(isNeutralDevelop({ ...RAW_NEUTRAL_DEVELOP, highlightRecovery: 0.2 })).toBe(false);
    expect(isNeutralDevelop({ ...RAW_NEUTRAL_DEVELOP, wb: { mode: 'custom', temperatureK: 5200, tint: 0 } })).toBe(false);
  });
});

describe('DevelopPanel binding', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(state: RawDevelopState, onChange: (next: RawDevelopState) => void, disabled = false) {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<DevelopPanel state={state} onChange={onChange} asShot={AS_SHOT} disabled={disabled} />);
    });
    return container;
  }

  const q = (el: HTMLElement, id: string) => el.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

  it('shows as-shot WB and switches custom mode seeded from the camera value', () => {
    const seen: RawDevelopState[] = [];
    const el = render(normalizeDevelop(null), (next) => seen.push(next));
    expect(el.querySelector('[data-testid="develop-as-shot-label"]')!.textContent).toContain('5200K');
    expect(q(el, 'develop-temperature')).toBeNull();
    act(() => q(el, 'develop-wb-custom').click());
    expect(seen[0].wb).toEqual({ mode: 'custom', temperatureK: 5200, tint: 0 });
  });

  it('emits clamped custom temperature, tint, exposure and recovery values', () => {
    const seen: RawDevelopState[] = [];
    const state = normalizeDevelop({ wb: { mode: 'custom', temperatureK: 5000, tint: 0 } });
    const el = render(state, (next) => seen.push(next));

    const change = (id: string, value: string) => {
      const input = q(el, id);
      // Bypass React's value tracker so the synthetic input event is not deduped.
      nativeValueSetter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    act(() => change('develop-temperature', '9000'));
    act(() => change('develop-tint', '-20'));
    act(() => change('develop-exposure', '1.5'));
    act(() => change('develop-highlight', '0.5'));

    const customTemps = seen.map((s) => (s.wb.mode === 'custom' ? s.wb.temperatureK : null));
    const customTints = seen.map((s) => (s.wb.mode === 'custom' ? s.wb.tint : null));
    expect(customTemps).toContain(9000);
    expect(customTints).toContain(-20);
    expect(seen.map((s) => s.exposureEV)).toContain(1.5);
    // Controlled component: each event is emitted against the current prop snapshot.
    expect(seen[seen.length - 1]).toMatchObject({ highlightRecovery: 0.5, wb: { mode: 'custom', temperatureK: 5000 } });
  });

  it('resets to neutral and disables controls when asked', () => {
    const seen: RawDevelopState[] = [];
    const state = normalizeDevelop({ exposureEV: 2 });
    const el = render(state, (next) => seen.push(next));
    act(() => q(el, 'develop-reset').click());
    expect(isNeutralDevelop(seen[0])).toBe(true);

    const disabledEl = render(state, () => undefined, true);
    expect(q(disabledEl, 'develop-exposure').disabled).toBe(true);
    expect(q(disabledEl, 'develop-wb-custom').disabled).toBe(true);
  });
});

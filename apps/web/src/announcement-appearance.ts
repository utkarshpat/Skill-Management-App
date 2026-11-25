import type { Appearance } from './announcement-model';

export const backgrounds = {
  teal: { label: 'Soft teal', fill: '#e6f5f3', ink: '#123e40', textSurface: '#e6f5f3' },
  'blue-red': {
    label: 'Blue to red gradient',
    fill: 'linear-gradient(135deg, #1e3a8a, #991b1b)',
    ink: '#ffffff',
    textSurface: '#1e3a8a',
  },
  neutral: { label: 'Soft grey', fill: '#eef2f6', ink: '#182235', textSurface: '#eef2f6' },
};
export const buttons = {
  teal: { label: 'Teal', fill: '#126b70' },
  green: { label: 'Green', fill: '#166534' },
  navy: { label: 'Navy', fill: '#182235' },
};
export const spacing = {
  compact: { label: 'Compact', gap: '8px', padding: '14px' },
  comfortable: { label: 'Comfortable', gap: '14px', padding: '24px' },
};
export const columns = { one: { label: 'One column' }, two: { label: 'Two columns' } };

export function appearanceValues(appearance: Appearance) {
  return {
    background: appearance.background ? backgrounds[appearance.background] : undefined,
    button: appearance.button ? buttons[appearance.button] : undefined,
    space: appearance.spacing ? spacing[appearance.spacing] : undefined,
    columns: appearance.columns,
  };
}

export function sandboxAppearanceCss(appearance?: Appearance) {
  if (!appearance) return '';
  const { background, button, space } = appearanceValues(appearance);
  return [
    background &&
      `#bridge-canvas,#bridge-canvas > * {background:${background.fill}!important;color:${background.ink}!important}
        #bridge-canvas :is(#ann-title,#ann-message) {background:${background.textSurface}!important;color:${background.ink}!important}
        #bridge-canvas :is(label,legend,output) {background:#f7f9fc!important;color:#182235!important}`,
    button &&
      `#bridge-canvas :is(#ann-submit,[id^="ann-vote-"]) {background:${button.fill}!important;color:#fff!important;border-color:transparent!important}`,
    space &&
      `#bridge-canvas > * {padding:${space.padding}!important;gap:${space.gap}!important}
        #bridge-canvas :is(#ann-form,.ann-fields) {gap:${space.gap}!important}`,
  ]
    .filter(Boolean)
    .join('\n');
}

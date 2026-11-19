// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import hi from './hi.js';
import { makeTranslator } from './translate.js';

describe('the page translator', () => {
  it('turns words drawn by CSS from data-word, like the password box Show', async () => {
    const { startDomTranslation } = await import('./dom.js');
    const root = document.createElement('div');
    root.innerHTML = '<span class="ui-pw-word" data-word="Show"></span>';
    document.body.appendChild(root);
    const stop = startDomTranslation(root, makeTranslator(hi));
    expect(root.querySelector('span').getAttribute('data-word')).toBe('दिखाएँ');
    if (typeof stop === 'function') stop();
    root.remove();
  });
});

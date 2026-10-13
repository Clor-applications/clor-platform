import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import SettingsScreenHeader from './SettingsScreenHeader';
import { SETTINGS_ACTIONS_SLOT_ID, SettingsFrameContext } from './settingsFrame';

/**
 * One heading per settings page, wherever the screen is standing.
 *
 * Ten screens printed their own `PageHeader` inside a frame that already
 * printed the title from the registry: the title appeared twice and the page
 * carried two `<h1>`s. Deleting the headers would have taken their Save and
 * Back buttons with them, and would have left the screens the registry does
 * not list — document numbering is one — with no heading at all.
 */

/* The frame, as far as a header can see it: the slot, and the word that it
   is inside one. */
const Framed = ({ children }) => (
  <SettingsFrameContext.Provider value>
    <div>
      <h1>Permissions</h1>
      <div id={SETTINGS_ACTIONS_SLOT_ID} data-testid="slot" />
      {children}
    </div>
  </SettingsFrameContext.Provider>
);

const actions = (
  <>
    <button type="button">Revert</button>
    <button type="button">Save changes</button>
  </>
);

describe('a framed settings screen', () => {
  it('does not print the title the frame has already printed', () => {
    render(
      <Framed>
        <SettingsScreenHeader entity="settings" title="Role Permissions" description="Tick what each role may do." />
      </Framed>
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText('Role Permissions')).toBeNull();
    expect(screen.queryByText('Tick what each role may do.')).toBeNull();
  });

  it('keeps its actions, in the frame’s own heading row', () => {
    render(
      <Framed>
        <SettingsScreenHeader title="Role Permissions" actions={actions} />
      </Framed>
    );
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeInTheDocument();
    /* Not merely on the page — inside the slot, which is what puts it beside
       the heading rather than above the content. */
    expect(screen.getByTestId('slot').contains(save)).toBe(true);
    expect(screen.getByTestId('slot').contains(screen.getByRole('button', { name: 'Revert' }))).toBe(true);
  });

  it('takes its actions away again when the screen leaves', () => {
    const view = render(
      <Framed>
        <SettingsScreenHeader title="Role Permissions" actions={actions} />
      </Framed>
    );
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    view.unmount();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});

describe('an unframed settings screen', () => {
  /* `settingsNumbering` is not in the registry, so nothing frames it and this
     header is the only one it has. */
  it('prints its whole header, title and all', () => {
    render(<SettingsScreenHeader entity="settings" title="Document numbering" description="Series and prefixes." actions={actions} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Document numbering' })).toBeInTheDocument();
    expect(screen.getByText('Series and prefixes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});

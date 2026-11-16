/*
 * The platform bar's two slots for an app that draws its own screen (Books).
 *
 * Such an app has its own search and its own account menu, so the platform bar
 * leaves its own out. Without somewhere to put them the app drew a second bar
 * under the first for three controls. The shell renders these two empty
 * elements in its bar and the app portals its controls into them, so a wide
 * screen has one bar, as People has.
 *
 * Narrower than BAR_SLOTS_QUERY the platform bar has no room for them (the
 * company picker, bell and help already fill it), and the app keeps its own bar.
 */
export const BAR_SLOT_START = 'clor-bar-slot-start';
export const BAR_SLOT_END = 'clor-bar-slot-end';
export const BAR_SLOTS_QUERY = '(min-width: 1100px)';

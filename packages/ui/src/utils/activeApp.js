/** The app the shell has open: it marks the document with it (data-app). Any screen shared by two apps can ask. */
export const activeApp = () => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-app')) || 'people';

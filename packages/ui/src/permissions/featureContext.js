import { createContext } from 'react';

/**
 * Effective feature flags for the active organisation. Kept in its own module
 * so the provider file exports only components.
 */
export const FeatureContext = createContext({
  loading: true,
  features: {},
  isEnabled: () => true,
  reload: () => {},
});

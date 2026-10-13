import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FeatureContext } from './featureContext';
import { getFeatures } from '../api/features';

/**
 * Loads the organisation's feature flags once per session.
 *
 * Defaults to enabled while loading: hiding navigation and then revealing it a
 * moment later is worse than showing it and letting the server refuse.
 */
export const FeatureProvider = ({ children, enabled = true, reloadKey = 0 }) => {
  const [state, setState] = useState({ loading: enabled, features: {} });

  const load = useCallback(() => {
    if (!enabled) return;
    Promise.resolve()
      .then(getFeatures)
      .then((data) => setState({ loading: false, features: data?.features || {} }))
      .catch(() => setState({ loading: false, features: {} }));
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const value = useMemo(() => {
    const { loading, features } = state;
    const isEnabled = (key) => {
      if (!key) return true;
      if (loading) return true;
      // An unknown key is treated as on, so a feature added to the UI before the
      // server knows about it does not vanish.
      if (!Object.prototype.hasOwnProperty.call(features, key)) return true;
      return Boolean(features[key]);
    };
    return { loading, features, isEnabled, reload: load };
  }, [state, load]);

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
};

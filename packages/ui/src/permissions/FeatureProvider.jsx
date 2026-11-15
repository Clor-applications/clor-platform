import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FeatureContext } from './featureContext';
import { getFeatures } from '../api/features';
import { orgId as platformOrgId } from '@platform/context';

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
      .then((data) => {
        const features = data?.features || {};
        const orgId = platformOrgId();
        if (orgId) localStorage.setItem(`periodLockFeature:${orgId}`, String(features.periodLock !== false));
        setState({ loading: false, features });
      })
      .catch(() => setState({ loading: false, features: {} }));
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const value = useMemo(() => {
    const { loading, features } = state;
    const isEnabled = (key) => {
      if (!key) return true;
      if (loading) return !['customerCodes', 'vendorCodes'].includes(key);
      // An unknown key is treated as on, so a feature added to the UI before the
      // server knows about it does not vanish.
      if (!Object.prototype.hasOwnProperty.call(features, key)) return !['customerCodes', 'vendorCodes'].includes(key);
      return Boolean(features[key]);
    };
    return { loading, features, isEnabled, reload: load };
  }, [state, load]);

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
};

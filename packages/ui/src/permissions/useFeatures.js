import { useContext } from 'react';
import { FeatureContext } from './featureContext';

/** Feature flags for the active organisation. */
export const useFeatures = () => useContext(FeatureContext);

import React from 'react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { FeatureCatalog, FeatureFilters, FeatureSaveActions } from './FeatureCatalog';
import { useFeatureCatalog } from './useFeatureCatalog';

/**
 * Features as a full page.
 *
 * The rail no longer comes here: it opens FeaturesPanel over whatever screen
 * is showing, so the invoice being typed stays where it was. This page still
 * answers `#/features` and the seven retired settings routes, because they
 * have been linked and bookmarked, and a saved link should land on the thing
 * it named rather than on a redirect.
 *
 * Same catalogue, same filters, same one save — composed, not copied.
 */
export const FeaturesPage = ({ onNavigate = null, currentCompany = null, setDb = null }) => {
  const model = useFeatureCatalog(currentCompany, setDb);

  return (
    <div className="features-page space-y-3">
      <div className="features-sticky-header">
        <PageHeader
          entity="settings"
          title="Features"
          actions={(
            <>
        <FeatureFilters model={model} />
              <FeatureSaveActions model={model} />
            </>
          )}
        />
      </div>
      <FeatureCatalog model={model} onNavigate={onNavigate} />
    </div>
  );
};

export default FeaturesPage;

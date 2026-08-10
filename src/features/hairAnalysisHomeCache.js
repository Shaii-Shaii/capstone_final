let cachedHairAnalysisHomeData = null;
let cachedHairAnalysisHomeUserId = '';

export const getCachedHairAnalysisHomeData = (userId = '') => (
  cachedHairAnalysisHomeData && cachedHairAnalysisHomeUserId === userId
    ? cachedHairAnalysisHomeData
    : null
);

export const setCachedHairAnalysisHomeData = (userId = '', data = null) => {
  cachedHairAnalysisHomeUserId = userId || '';
  cachedHairAnalysisHomeData = data;
};

export const invalidateHairAnalysisHomeCache = (userId = '') => {
  if (!userId || cachedHairAnalysisHomeUserId === userId) {
    cachedHairAnalysisHomeUserId = '';
    cachedHairAnalysisHomeData = null;
  }
};

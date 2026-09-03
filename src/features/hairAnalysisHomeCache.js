let cachedHairAnalysisHomeData = null;
let cachedHairAnalysisHomeUserId = '';
const HAIR_ANALYSIS_HOME_CACHE_TTL_MS = 30 * 1000;

export const getCachedHairAnalysisHomeData = (userId = '') => (
  cachedHairAnalysisHomeData && cachedHairAnalysisHomeUserId === userId
    ? cachedHairAnalysisHomeData
    : null
);

export const setCachedHairAnalysisHomeData = (userId = '', data = null) => {
  cachedHairAnalysisHomeUserId = userId || '';
  cachedHairAnalysisHomeData = data ? {
    ...data,
    cachedAt: data.cachedAt || Date.now(),
  } : null;
};

export const isHairAnalysisHomeCacheFresh = (userId = '') => {
  const cached = getCachedHairAnalysisHomeData(userId);
  return Boolean(cached?.cachedAt && Date.now() - cached.cachedAt < HAIR_ANALYSIS_HOME_CACHE_TTL_MS);
};

export const invalidateHairAnalysisHomeCache = (userId = '') => {
  if (!userId || cachedHairAnalysisHomeUserId === userId) {
    cachedHairAnalysisHomeUserId = '';
    cachedHairAnalysisHomeData = null;
  }
};

const toFiniteLevel = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const deriveHairMetrics = (screening = null) => {
  const condition = String(screening?.detected_condition || '').toLowerCase();
  const damageNotes = String(screening?.visible_damage_notes || '').toLowerCase();
  const texture = String(screening?.detected_texture || '').toLowerCase();

  return {
    shine: toFiniteLevel(screening?.shine_level)
      ?? (condition.includes('healthy') || condition.includes('good') ? 8 : condition.includes('dry') || condition.includes('damaged') ? 3 : 5),
    frizz: toFiniteLevel(screening?.frizz_level)
      ?? (condition.includes('frizz') ? 7 : condition.includes('healthy') ? 2 : texture.includes('wavy') || texture.includes('curly') ? 5 : 3),
    dryness: toFiniteLevel(screening?.dryness_level)
      ?? (condition.includes('dry') ? 8 : condition.includes('healthy') ? 2 : condition.includes('oily') ? 1 : 4),
    oiliness: toFiniteLevel(screening?.oiliness_level)
      ?? (condition.includes('oily') || condition.includes('greasy') ? 8 : condition.includes('healthy') ? 2 : condition.includes('dry') ? 1 : 3),
    damage: toFiniteLevel(screening?.damage_level)
      ?? (damageNotes.includes('split') || damageNotes.includes('break') || condition.includes('damaged') ? 8 : condition.includes('healthy') ? 1 : condition.includes('dry') ? 5 : 3),
  };
};

const hasNegatedCareConcern = (text = '') => (
  /\b(no|not|without)\s+(?:visible\s+|significant\s+|major\s+)?(?:damage|dryness|frizz|breakage|split\s+ends?|issues?)\b/i.test(text)
  || /\bno\s+significant\s+damage\s+or\s+issues\b/i.test(text)
  || /\bsealed\s+ends?\b/i.test(text)
);

const hasExplicitCareConcern = (text = '') => {
  const normalized = String(text || '').toLowerCase();
  const negated = hasNegatedCareConcern(normalized);
  if (/(split\s+ends?|split\s+tips?|breakage|brittle|fray(?:ed|ing)|frizz|flyaways|oily|greasy|stressed\s+ends)/i.test(normalized)) {
    return true;
  }
  return /(dry|dull|damage|damaged|needs care|improve hair condition)/i.test(normalized) && !negated;
};

export const getCanonicalHairAssessment = (screening = null) => {
  if (!screening) {
    return { label: 'No result yet', needsCare: false, issueLabel: 'No result' };
  }

  const combined = [
    screening.detected_condition,
    screening.visible_damage_notes,
    screening.summary,
    screening.decision,
  ].filter(Boolean).join(' ');
  const condition = String(screening.detected_condition || '').trim();
  const metrics = deriveHairMetrics(screening);
  const metricConcern = (
    metrics.dryness >= 6
    || metrics.damage >= 6
    || metrics.frizz >= 6
    || metrics.oiliness >= 7
  );
  const needsCare = hasExplicitCareConcern(combined) || metricConcern;

  if (!needsCare && (/healthy|good|eligible/i.test(combined) || condition)) {
    return { label: condition || 'Healthy', needsCare: false, issueLabel: 'Good result' };
  }

  const issueLabel = [
    metrics.damage >= 6 || /split|breakage|damage|fray|stressed/i.test(combined) ? 'Damage' : '',
    metrics.dryness >= 6 || /dry|dull/i.test(combined) ? 'Dryness' : '',
    metrics.frizz >= 6 || /frizz|flyaway/i.test(combined) ? 'Frizz' : '',
    metrics.oiliness >= 7 || /oily|greasy/i.test(combined) ? 'Oiliness' : '',
  ].filter(Boolean)[0] || 'Needs care';

  return {
    label: condition && !/healthy/i.test(condition) ? condition : issueLabel,
    needsCare: true,
    issueLabel,
  };
};

export const getHairScreeningMood = (screening = null) => {
  if (!screening) {
    return {
      key: 'neutral',
      icon: 'emoticon-neutral-outline',
      color: '#D18A3A',
      surface: '#F8EAD8',
      label: 'No result yet',
    };
  }

  const assessment = getCanonicalHairAssessment(screening);
  const metrics = deriveHairMetrics(screening);
  const combined = [
    assessment.label,
    screening.detected_condition,
    screening.visible_damage_notes,
    screening.summary,
  ].filter(Boolean).join(' ');

  const hasStrongConcern = (
    metrics.damage >= 7
    || metrics.dryness >= 7
    || metrics.frizz >= 7
    || metrics.oiliness >= 8
    || /severe|significant|\bdamage(?:d)?\b|breakage|split\s+ends?|brittle|fray/i.test(combined)
  );

  if (hasStrongConcern) {
    return {
      key: 'sad',
      icon: 'emoticon-sad-outline',
      color: '#B84D58',
      surface: '#F8E4E7',
      label: 'Needs care',
    };
  }

  if (assessment.needsCare || /treated|colored|rebonded/i.test(combined)) {
    return {
      key: 'neutral',
      icon: 'emoticon-neutral-outline',
      color: '#B9772B',
      surface: '#F8EAD8',
      label: 'Keep caring',
    };
  }

  return {
    key: 'happy',
    icon: 'emoticon-happy-outline',
    color: '#3F8A57',
    surface: '#E3F3E5',
    label: 'Looking good',
  };
};

export const getScreeningEntriesNewestFirst = (submissions = []) => (
  submissions
    .flatMap((submission) => (submission?.ai_screenings || []).map((screening) => ({ submission, screening })))
    .filter((entry) => entry.screening?.created_at)
    .sort((left, right) => {
      const timeDifference = new Date(right.screening.created_at).getTime()
        - new Date(left.screening.created_at).getTime();
      if (timeDifference) return timeDifference;
      return Number(right.screening.ai_screening_id || 0) - Number(left.screening.ai_screening_id || 0);
    })
);

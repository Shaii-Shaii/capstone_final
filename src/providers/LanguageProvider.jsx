import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

const LANGUAGE_STORAGE_KEY = '@donivra/language';
const DEFAULT_LANGUAGE = 'en';

export const supportedLanguages = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'fil', label: 'Filipino', nativeLabel: 'Filipino' },
];

const translations = {
  en: {
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.selected': 'Selected',
    'nav.home': 'Home',
    'nav.analysis': 'Analysis',
    'nav.donate': 'Donate',
    'nav.wig': 'Wig',
    'nav.profile': 'Profile',
    'header.goodMorning': 'Good morning',
    'header.goodAfternoon': 'Good afternoon',
    'header.goodEvening': 'Good evening',
    'header.hairDonor': 'Hair Donor',
    'profile.title': 'My profile',
    'profile.subtitle': 'Account and preferences',
    'profile.donations': 'Donations',
    'profile.achievements': 'Achievements',
    'profile.account': 'Account',
    'profile.edit': 'Edit Profile',
    'profile.editSubtitle': 'Update your personal details',
    'profile.changePassword': 'Change Password',
    'profile.changePasswordSubtitle': 'Keep your account secure',
    'profile.history': 'History',
    'profile.historySubtitle': 'Review your donation journey',
    'profile.achievementsSubtitle': 'View certificates and milestones',
    'profile.preferences': 'Preferences & support',
    'profile.language': 'Language',
    'profile.languageSubtitle': 'Choose your app language',
    'profile.textSize': 'Text size',
    'profile.textSizeSubtitle': 'Resize application text',
    'profile.notifications': 'Notifications',
    'profile.notificationsSubtitle': 'View your latest updates',
    'profile.feedback': 'Feedback',
    'profile.feedbackSubtitle': 'Tell us about your experience',
    'profile.help': 'Help',
    'profile.helpSubtitle': 'Get help and app information',
    'profile.logout': 'Log out',
    'profile.medicalInformation': 'Medical Information',
    'profile.accountSettings': 'Account Settings',
    'profile.personalInformation': 'Personal Information',
    'profile.helpGuide': 'Help & User Guide',
    'profile.helpGuideSubtitle': 'Learn how to use Donivra',
    'language.title': 'App language',
    'language.subtitle': 'Choose the language used for Donivra menus and guidance.',
    'language.englishDescription': 'Use Donivra in English.',
    'language.filipinoDescription': 'Gamitin ang Donivra sa Filipino.',
    'textSize.title': 'Application text size',
    'textSize.subtitle': 'Choose the maximum size allowed when your device enlarges text.',
    'textSize.default': 'Default',
    'textSize.defaultDescription': 'Standard text size (100%).',
    'textSize.large': 'Large',
    'textSize.largeDescription': 'Allows text up to 120%.',
    'textSize.maximum': 'Maximum',
    'textSize.maximumDescription': 'Allows text up to 135% without cutting controls.',
    'logout.eyebrow': 'ACCOUNT SESSION',
    'logout.title': 'Log out of Donivra?',
    'logout.body': 'You will need to sign in again to access your profile and donation activity.',
    'logout.note': 'Your saved account data will remain secure.',
    'logout.loading': 'Logging out...',
    'logout.stay': 'Stay signed in',
    'home.hairOverview': 'HAIR CARE OVERVIEW',
    'home.latestHairUpdate': 'Your latest hair update',
    'home.searchEvent': 'Find an event...',
    'home.upcomingEvents': 'Upcoming donation events',
    'home.yourActivity': 'Your activity',
    'home.joinedEvent': 'YOUR JOINED EVENT',
    'home.registered': 'Registered',
    'home.attended': 'Attended',
    'home.cancelled': 'Cancelled',
    'donate.eventsEyebrow': 'DONATION EVENTS',
    'donate.availableEvents': 'Available events',
    'donate.eventCount': '{count} {label}',
    'analysis.title': 'Your hair health',
    'analysis.subtitle': 'See your latest result and follow changes over time.',
    'analysis.latestResult': 'LATEST RESULT',
    'analysis.weekRange': 'Week {range}',
    'analysis.completeFirst': 'Complete your first check to begin.',
    'analysis.length': 'Length',
    'analysis.texture': 'Texture',
    'analysis.condition': 'Condition',
    'analysis.moisture': 'Moisture',
    'analysis.hairHistory': 'Hair history',
    'analysis.historySubtitle': 'Review saved results by week or month.',
    'analysis.week': 'Week',
    'analysis.month': 'Month',
    'analysis.weeklyView': 'Weekly view',
    'analysis.monthlyView': 'Monthly view',
    'analysis.calendarLegend': 'Marked dates have saved results. Tap one to open it.',
    'analysis.recentResults': 'Recent results',
    'analysis.recentSubtitle': 'Open a result to view the full assessment and guidance.',
    'analysis.noResults': 'No saved results yet',
    'analysis.noResultsMessage': 'Start a hair check to save your first result.',
    'analysis.completeProfile': 'Complete Profile',
    'analysis.startFirst': 'Start First Hair Check',
    'analysis.viewRecent': 'View Recent Log',
    'analysis.start': 'Start Hair Analysis',
    'analysis.eligible': 'Eligible for donation',
    'analysis.notEligible': 'Not eligible for donation yet',
    'analysis.measuredRequired': '{measured} in measured · {required} in required',
    'analysis.viewDetails': 'View details',
    'analysis.eligibleShort': 'Eligible',
    'analysis.reviewRequirements': 'Review requirements',
    'analysis.healthy': 'Healthy',
    'analysis.needsCare': 'Needs care',
    'analysis.damage': 'Damage',
    'analysis.wavy': 'Wavy',
    'analysis.straight': 'Straight',
    'analysis.curly': 'Curly',
    'analysis.balanced': 'Balanced',
    'analysis.medium': 'Medium',
    'analysis.low': 'Low',
    'analysis.unknown': 'Unknown',
  },
  fil: {
    'common.cancel': 'Kanselahin',
    'common.close': 'Isara',
    'common.selected': 'Napili',
    'nav.home': 'Home',
    'nav.analysis': 'Pagsusuri',
    'nav.donate': 'Mag-donate',
    'nav.wig': 'Peluka',
    'nav.profile': 'Profile',
    'header.goodMorning': 'Magandang umaga',
    'header.goodAfternoon': 'Magandang hapon',
    'header.goodEvening': 'Magandang gabi',
    'header.hairDonor': 'Donor ng Buhok',
    'profile.title': 'Aking profile',
    'profile.subtitle': 'Account at mga kagustuhan',
    'profile.donations': 'Mga donasyon',
    'profile.achievements': 'Mga tagumpay',
    'profile.account': 'Account',
    'profile.edit': 'I-edit ang Profile',
    'profile.editSubtitle': 'I-update ang iyong personal na detalye',
    'profile.changePassword': 'Palitan ang Password',
    'profile.changePasswordSubtitle': 'Panatilihing ligtas ang iyong account',
    'profile.history': 'Kasaysayan',
    'profile.historySubtitle': 'Tingnan ang iyong paglalakbay sa pagdo-donate',
    'profile.achievementsSubtitle': 'Tingnan ang mga sertipiko at tagumpay',
    'profile.preferences': 'Mga kagustuhan at suporta',
    'profile.language': 'Wika',
    'profile.languageSubtitle': 'Piliin ang wika ng app',
    'profile.textSize': 'Laki ng teksto',
    'profile.textSizeSubtitle': 'Baguhin ang laki ng teksto sa app',
    'profile.notifications': 'Mga abiso',
    'profile.notificationsSubtitle': 'Tingnan ang iyong mga bagong update',
    'profile.feedback': 'Feedback',
    'profile.feedbackSubtitle': 'Ibahagi ang iyong karanasan',
    'profile.help': 'Tulong',
    'profile.helpSubtitle': 'Kumuha ng tulong at impormasyon tungkol sa app',
    'profile.logout': 'Mag-log out',
    'profile.medicalInformation': 'Impormasyong Medikal',
    'profile.accountSettings': 'Mga Setting ng Account',
    'profile.personalInformation': 'Personal na Impormasyon',
    'profile.helpGuide': 'Tulong at Gabay',
    'profile.helpGuideSubtitle': 'Alamin kung paano gamitin ang Donivra',
    'language.title': 'Wika ng app',
    'language.subtitle': 'Piliin ang wikang gagamitin sa mga menu at gabay ng Donivra.',
    'language.englishDescription': 'Gamitin ang Donivra sa English.',
    'language.filipinoDescription': 'Gamitin ang Donivra sa Filipino.',
    'textSize.title': 'Laki ng teksto sa app',
    'textSize.subtitle': 'Piliin ang pinakamalaking sukat kapag pinalalaki ng device ang teksto.',
    'textSize.default': 'Default',
    'textSize.defaultDescription': 'Karaniwang laki ng teksto (100%).',
    'textSize.large': 'Malaki',
    'textSize.largeDescription': 'Pinapayagan ang teksto hanggang 120%.',
    'textSize.maximum': 'Pinakamalaki',
    'textSize.maximumDescription': 'Pinapayagan hanggang 135% nang hindi napuputol ang mga control.',
    'logout.eyebrow': 'SESSION NG ACCOUNT',
    'logout.title': 'Mag-log out sa Donivra?',
    'logout.body': 'Kailangan mong mag-sign in muli upang ma-access ang iyong profile at mga donasyon.',
    'logout.note': 'Mananatiling ligtas ang naka-save na data ng iyong account.',
    'logout.loading': 'Nagla-log out...',
    'logout.stay': 'Manatiling naka-sign in',
    'home.hairOverview': 'PANGKALAHATANG PANGANGALAGA SA BUHOK',
    'home.latestHairUpdate': 'Pinakabagong update sa iyong buhok',
    'home.searchEvent': 'Maghanap ng event...',
    'home.upcomingEvents': 'Mga paparating na donation event',
    'home.yourActivity': 'Iyong aktibidad',
    'home.joinedEvent': 'EVENT NA IYONG SINALIHAN',
    'home.registered': 'Rehistrado',
    'home.attended': 'Dumalo',
    'home.cancelled': 'Kinansela',
    'donate.eventsEyebrow': 'MGA DONATION EVENT',
    'donate.availableEvents': 'Mga available na event',
    'donate.eventCount': '{count} {label}',
    'analysis.title': 'Kalusugan ng iyong buhok',
    'analysis.subtitle': 'Tingnan ang pinakabagong resulta at subaybayan ang mga pagbabago.',
    'analysis.latestResult': 'PINAKABAGONG RESULTA',
    'analysis.weekRange': 'Linggo {range}',
    'analysis.completeFirst': 'Kumpletuhin ang unang pagsusuri upang magsimula.',
    'analysis.length': 'Haba',
    'analysis.texture': 'Texture',
    'analysis.condition': 'Kondisyon',
    'analysis.moisture': 'Moisture',
    'analysis.hairHistory': 'Kasaysayan ng buhok',
    'analysis.historySubtitle': 'Tingnan ang mga naka-save na resulta bawat linggo o buwan.',
    'analysis.week': 'Linggo',
    'analysis.month': 'Buwan',
    'analysis.weeklyView': 'Lingguhang view',
    'analysis.monthlyView': 'Buwanang view',
    'analysis.calendarLegend': 'Ang may markang petsa ay may naka-save na resulta. I-tap upang buksan.',
    'analysis.recentResults': 'Mga kamakailang resulta',
    'analysis.recentSubtitle': 'Magbukas ng resulta upang makita ang buong pagsusuri at gabay.',
    'analysis.noResults': 'Wala pang naka-save na resulta',
    'analysis.noResultsMessage': 'Magsimula ng hair check upang mai-save ang unang resulta.',
    'analysis.completeProfile': 'Kumpletuhin ang Profile',
    'analysis.startFirst': 'Simulan ang Unang Hair Check',
    'analysis.viewRecent': 'Tingnan ang Kamakailang Log',
    'analysis.start': 'Simulan ang Pagsusuri ng Buhok',
    'analysis.eligible': 'Kwalipikado para sa donasyon',
    'analysis.notEligible': 'Hindi pa kwalipikado para sa donasyon',
    'analysis.measuredRequired': '{measured} in ang sukat · {required} in ang kailangan',
    'analysis.viewDetails': 'Tingnan ang detalye',
    'analysis.eligibleShort': 'Kwalipikado',
    'analysis.reviewRequirements': 'Suriin ang mga kinakailangan',
    'analysis.healthy': 'Malusog',
    'analysis.needsCare': 'Kailangan ng pag-aalaga',
    'analysis.damage': 'May pinsala',
    'analysis.wavy': 'Alon-alon',
    'analysis.straight': 'Tuwid',
    'analysis.curly': 'Kulot',
    'analysis.balanced': 'Balansyado',
    'analysis.medium': 'Katamtaman',
    'analysis.low': 'Mababa',
    'analysis.unknown': 'Hindi matukoy',
  },
};

const LanguageContext = React.createContext(null);

const interpolate = (value, variables = {}) => Object.entries(variables).reduce(
  (result, [key, replacement]) => result.split(`{${key}}`).join(String(replacement)),
  value,
);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = React.useState(DEFAULT_LANGUAGE);

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((storedLanguage) => {
        if (active && supportedLanguages.some((item) => item.code === storedLanguage)) {
          setLanguageState(storedLanguage);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = React.useCallback(async (nextLanguage) => {
    const safeLanguage = supportedLanguages.some((item) => item.code === nextLanguage)
      ? nextLanguage
      : DEFAULT_LANGUAGE;
    setLanguageState(safeLanguage);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, safeLanguage);
    } catch (_error) {
      // The in-memory selection still works when device storage is unavailable.
    }
  }, []);

  const t = React.useCallback((key, variables = {}) => {
    const englishValue = translations.en[key] || key;
    const localizedValue = translations[language]?.[key] || englishValue;
    return interpolate(localizedValue, variables);
  }, [language]);

  const value = React.useMemo(() => ({
    language,
    isFilipino: language === 'fil',
    setLanguage,
    supportedLanguages,
    t,
  }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = React.useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider.');
  return context;
}

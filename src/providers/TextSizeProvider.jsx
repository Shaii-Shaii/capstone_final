import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text, TextInput } from 'react-native';

const TEXT_SIZE_STORAGE_KEY = '@donivra/text-size';
const DEFAULT_TEXT_SIZE = 'default';

export const textSizeOptions = [
  { code: 'default', multiplier: 1.0 },
  { code: 'large', multiplier: 1.2 },
  { code: 'maximum', multiplier: 1.35 },
];

const getSafeTextSize = (value) => (
  textSizeOptions.some((option) => option.code === value) ? value : DEFAULT_TEXT_SIZE
);

const applyGlobalTextPreferences = (textSize) => {
  const option = textSizeOptions.find((item) => item.code === textSize) || textSizeOptions[0];
  const sharedDefaults = {
    allowFontScaling: true,
    maxFontSizeMultiplier: option.multiplier,
  };

  Text.defaultProps = {
    ...(Text.defaultProps || {}),
    ...sharedDefaults,
  };
  TextInput.defaultProps = {
    ...(TextInput.defaultProps || {}),
    ...sharedDefaults,
  };
};

applyGlobalTextPreferences(DEFAULT_TEXT_SIZE);

const TextSizeContext = React.createContext(null);

export function TextSizeProvider({ children }) {
  const [textSize, setTextSizeState] = React.useState(DEFAULT_TEXT_SIZE);

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(TEXT_SIZE_STORAGE_KEY)
      .then((storedValue) => {
        if (!active) return;
        const safeValue = getSafeTextSize(storedValue);
        applyGlobalTextPreferences(safeValue);
        setTextSizeState(safeValue);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setTextSize = React.useCallback(async (nextValue) => {
    const safeValue = getSafeTextSize(nextValue);
    applyGlobalTextPreferences(safeValue);
    setTextSizeState(safeValue);
    try {
      await AsyncStorage.setItem(TEXT_SIZE_STORAGE_KEY, safeValue);
    } catch (_error) {
      // Keep the active in-memory preference when storage is unavailable.
    }
  }, []);

  const selectedOption = React.useMemo(
    () => textSizeOptions.find((option) => option.code === textSize) || textSizeOptions[0],
    [textSize],
  );

  const value = React.useMemo(() => ({
    maxFontSizeMultiplier: selectedOption.multiplier,
    setTextSize,
    textSize,
    textSizeOptions,
  }), [selectedOption.multiplier, setTextSize, textSize]);

  return <TextSizeContext.Provider value={value}>{children}</TextSizeContext.Provider>;
}

export function useTextSize() {
  const context = React.useContext(TextSizeContext);
  if (!context) throw new Error('useTextSize must be used inside TextSizeProvider.');
  return context;
}

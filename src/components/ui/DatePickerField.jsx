import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AppIcon } from './AppIcon';
import { AppTextLink } from './AppTextLink';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';

const readableDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const formatDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateValue = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsedDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return parsedDate;
};

const formatReadableDate = (value) => {
  const parsedDate = value instanceof Date ? value : parseDateValue(value);
  if (!parsedDate) return '';
  return readableDateFormatter.format(parsedDate);
};

export function DatePickerField({
  label,
  required = false,
  value,
  placeholder,
  helperText,
  error,
  onChange,
  onBlur,
  minimumDate,
  maximumDate,
  onPress,
  leftIcon,
  leftIconColor,
  rightIcon = 'appointment',
  rightIconColor,
  leftIconContainerStyle,
  rightIconContainerStyle,
  labelStyle,
  shellStyle,
  valueStyle,
  placeholderStyle,
  helperTextStyle,
  errorTextStyle,
  containerStyle,
}) {
  const { resolvedTheme } = useAuth();
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const roles = resolveThemeRoles(resolvedTheme);
  const parsedDateValue = useMemo(() => parseDateValue(value), [value]);
  const maximumDateValue = useMemo(
    () => (maximumDate instanceof Date ? maximumDate : null),
    [maximumDate]
  );
  const minimumDateValue = useMemo(
    () => (minimumDate instanceof Date ? minimumDate : null),
    [minimumDate]
  );
  const readableValue = useMemo(
    () => formatReadableDate(parsedDateValue),
    [parsedDateValue]
  );
  const fallbackDate = parsedDateValue || maximumDateValue || new Date();
  const primaryColor = resolvedTheme?.primaryColor || theme.colors.brandPrimary;
  const primaryTextColor = resolvedTheme?.primaryTextColor || theme.colors.textPrimary;
  const secondaryTextColor = resolvedTheme?.secondaryTextColor || theme.colors.textSecondary;
  const mutedTextColor = resolvedTheme?.tertiaryTextColor || theme.colors.textMuted;

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      setIsPickerVisible(false);
    }

    if (event.type === 'dismissed' || !selectedDate) {
      return;
    }

    onChange(formatDateValue(selectedDate));
    onBlur?.();
  };

  const openPicker = async () => {
    await onPress?.();

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: fallbackDate,
        mode: 'date',
        display: 'calendar',
        minimumDate: minimumDateValue || undefined,
        maximumDate: maximumDateValue || undefined,
        positiveButton: { label: 'Select', textColor: primaryColor },
        negativeButton: { label: 'Cancel', textColor: secondaryTextColor },
        onChange: handleDateChange,
      });
      return;
    }

    setIsPickerVisible(true);
  };

  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      <Text
        style={[
          styles.label,
          { color: error ? theme.colors.textError : primaryTextColor },
          labelStyle,
        ]}
      >
        {label}
        {required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${readableValue || placeholder}`}
        accessibilityHint="Opens the calendar"
        android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
        onPress={openPicker}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        style={[
          styles.fieldShell,
          {
            backgroundColor: roles.defaultCardBackground || theme.colors.surfaceCard,
            borderColor: roles.defaultCardBorder,
          },
          shellStyle,
          error ? styles.fieldShellError : null,
          isPressed ? styles.fieldShellPressed : null,
        ]}
      >
        {leftIcon ? (
          <View
            pointerEvents="none"
            style={[
              styles.fieldIconWrap,
              { backgroundColor: roles.iconPrimarySurface },
              leftIconContainerStyle,
            ]}
          >
            <AppIcon
              name={leftIcon}
              color={leftIconColor || primaryColor}
              size="sm"
            />
          </View>
        ) : null}
        <Text style={[
          styles.fieldValue,
          !value ? styles.fieldPlaceholder : null,
          { color: value ? primaryTextColor : mutedTextColor },
          valueStyle,
          !value ? placeholderStyle : null,
        ]}>
          {readableValue || placeholder}
        </Text>
        <View
          pointerEvents="none"
          style={[
            styles.fieldActionWrap,
            { backgroundColor: roles.iconPrimarySurface },
            rightIconContainerStyle,
          ]}
        >
          <AppIcon
            name={rightIcon}
            color={rightIconColor || primaryColor}
            state={error ? 'danger' : 'muted'}
            size="sm"
          />
        </View>
      </Pressable>

      {isPickerVisible && Platform.OS !== 'android' ? (
        <View
          style={[
            styles.pickerCard,
            {
              backgroundColor: roles.defaultCardBackground || theme.colors.surfaceCard,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <DateTimePicker
            value={fallbackDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            accentColor={Platform.OS === 'ios' ? primaryColor : undefined}
            minimumDate={minimumDateValue || undefined}
            maximumDate={maximumDateValue || undefined}
            onChange={handleDateChange}
          />

          {Platform.OS === 'ios' ? (
            <View style={styles.pickerActions}>
              <AppTextLink
                title="Cancel"
                variant="muted"
                onPress={() => setIsPickerVisible(false)}
              />
              <AppTextLink
                title="Done"
                onPress={() => setIsPickerVisible(false)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text style={[styles.fieldError, errorTextStyle]}>{error}</Text>
      ) : helperText ? (
        <Text style={[styles.fieldHelper, { color: secondaryTextColor }, helperTextStyle]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    width: '100%',
    minHeight: 82,
    marginBottom: theme.spacing.sm,
  },
  label: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.label,
    fontWeight: theme.typography.weights.semibold,
    marginBottom: theme.spacing.xs,
  },
  requiredMark: {
    color: theme.colors.textError,
  },
  fieldShell: {
    minHeight: theme.inputs.minHeightCompact,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceCard,
    paddingHorizontal: theme.spacing.inputPaddingXCompact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    overflow: 'hidden',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    shadowOpacity: 0.08,
    elevation: 2,
  },
  fieldShellPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.998 }],
  },
  fieldShellError: {
    borderColor: theme.colors.borderError,
  },
  fieldIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldActionWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldValue: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    color: theme.colors.textPrimary,
  },
  fieldPlaceholder: {
    color: theme.colors.textMuted,
  },
  fieldError: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.medium,
  },
  fieldHelper: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  pickerCard: {
    marginTop: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceCard,
    overflow: 'hidden',
  },
  pickerActions: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

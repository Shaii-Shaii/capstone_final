import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Controller, useWatch } from 'react-hook-form';
import phil from 'phil-reg-prov-mun-brgy';
import { AppInput } from '../ui/AppInput';
import { AppIcon } from '../ui/AppIcon';
import { SectionTitleRow } from '../ui/SectionTitleRow';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';

const sortByName = (items = []) => phil.sort(items, 'A');
const normalizeValue = (value = '') => value.trim().toLowerCase();

const REGION_OPTIONS = sortByName(phil.regions || []);

const fieldConfig = {
  street: {
    label: 'Street / Building / Landmark',
    placeholder: 'House number, street, subdivision, or landmark',
    helperText: 'Add the most specific street or landmark detail for pickup and verification.',
    icon: 'map-marker-outline',
  },
  region: {
    label: 'Region',
    placeholder: 'Select region',
    helperText: 'Choose the main Philippine region first.',
    icon: 'map-marker-radius-outline',
  },
  province: {
    label: 'Province',
    placeholder: 'Select province',
    helperText: 'This list updates after you choose a region.',
    icon: 'map-outline',
  },
  city: {
    label: 'City / Municipality',
    placeholder: 'Select city or municipality',
    helperText: 'Choose the city or municipality for your address.',
    icon: 'city-variant-outline',
  },
  barangay: {
    label: 'Barangay',
    placeholder: 'Select barangay',
    helperText: 'Choose the barangay that matches your city or municipality.',
    icon: 'home-city-outline',
  },
  country: {
    label: 'Country',
    placeholder: 'Philippines',
    icon: 'earth',
  },
};

const toSelectOptions = (items = [], codeKey) => (
  items.map((item) => ({
    label: item.name,
    value: item.name,
    code: item[codeKey],
  }))
);

export function AddressSelectField({
  label,
  required = false,
  value,
  placeholder,
  helperText,
  error,
  disabled = false,
  onPress,
  leftIcon,
  leftIconColor,
  rightIconColor,
  labelStyle,
  fieldStyle,
  valueStyle,
  placeholderStyle,
  helperTextStyle,
  errorTextStyle,
}) {
  return (
    <View style={styles.selectFieldWrap}>
      <Text style={[styles.selectFieldLabel, labelStyle]}>
        {label}
        {required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.selectField,
          disabled ? styles.selectFieldDisabled : null,
          error ? styles.selectFieldError : null,
          pressed && !disabled ? styles.selectFieldPressed : null,
          fieldStyle,
        ]}
      >
        <View pointerEvents="none" style={styles.selectFieldContent}>
          {leftIcon ? (
            <View style={styles.selectFieldLeftIconWrap}>
              <AppIcon name={leftIcon} color={leftIconColor} />
            </View>
          ) : null}
          <Text
            style={[
              styles.selectFieldValue,
              leftIcon ? styles.selectFieldValueWithIcon : null,
              !value ? styles.selectFieldPlaceholder : null,
              disabled ? styles.selectFieldValueDisabled : null,
              valueStyle,
              !value ? placeholderStyle : null,
            ]}
            numberOfLines={1}
          >
            {value || placeholder}
          </Text>
          <AppIcon
            name="chevronRight"
            color={rightIconColor}
            state={disabled ? 'disabled' : 'muted'}
          />
        </View>
      </Pressable>
      {error ? (
        <Text style={[styles.selectFieldErrorText, errorTextStyle]}>{error}</Text>
      ) : helperText ? (
        <Text style={[styles.selectFieldHelper, helperTextStyle]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

export function AddressOptionSheet({
  visible,
  title,
  placeholder,
  options,
  selectedValue,
  onClose,
  onSelect,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    if (visible) {
      setSearchValue('');
    }
  }, [visible, title]);

  const filteredOptions = useMemo(() => {
    const normalizedSearch = normalizeValue(searchValue);
    if (!normalizedSearch) return options;

    return options.filter((option) => (
      normalizeValue(option.label).includes(normalizedSearch)
    ));
  }, [options, searchValue]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <View style={[styles.sheetHandle, { backgroundColor: roles.defaultCardBorder }]} />
          <View style={styles.sheetHeader}>
            <View style={[styles.sheetHeaderIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <AppIcon name="format-list-bulleted" size="md" color={roles.iconPrimaryColor} />
            </View>
            <View style={styles.sheetHeaderCopy}>
              <Text style={[styles.sheetTitle, { color: roles.headingText }]}>{title}</Text>
              <Text style={[styles.sheetSubtitle, { color: roles.bodyText }]}>Choose the option that matches your profile.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              onPress={onClose}
              style={({ pressed }) => [styles.sheetCloseButton, { opacity: pressed ? 0.72 : 1 }]}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.sheetCloseSurface,
                  { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder },
                ]}
              >
                <AppIcon name="close" size="sm" color={roles.iconPrimaryColor} />
              </View>
            </Pressable>
          </View>

          <AppInput
            label=""
            placeholder={placeholder}
            variant="default"
            value={searchValue}
            onChangeText={setSearchValue}
            autoCorrect={false}
            autoCapitalize="words"
            leftIcon="magnify"
            style={styles.sheetSearchInput}
            shellStyle={[
              styles.sheetSearchShell,
              { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder },
            ]}
            inputStyle={[styles.sheetSearchText, { color: roles.headingText }]}
            leftIconColor={roles.iconPrimaryColor}
          />

          <View style={styles.sheetResultsRow}>
            <Text style={[styles.sheetResultsText, { color: roles.metaText }]}>
              {filteredOptions.length} {filteredOptions.length === 1 ? 'option' : 'options'}
            </Text>
            {selectedValue ? (
              <View style={[styles.sheetSelectedPill, { backgroundColor: roles.iconPrimarySurface }]}>
                <Text numberOfLines={1} style={[styles.sheetSelectedText, { color: roles.iconPrimaryColor }]}>Selected: {selectedValue}</Text>
              </View>
            ) : null}
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filteredOptions.length ? (
              filteredOptions.map((option, index) => {
                const isSelected = normalizeValue(option.value) === normalizeValue(selectedValue);

                return (
                  <Pressable
                    key={`${title}-${option.code || option.value || 'option'}-${index}`}
                    onPress={() => {
                      onSelect(option);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.sheetOption,
                      pressed ? styles.sheetOptionPressed : null,
                    ]}
                  >
                    <View
                      pointerEvents="none"
                      style={[
                        styles.sheetOptionSurface,
                        {
                          backgroundColor: isSelected ? roles.iconPrimarySurface : roles.defaultCardBackground,
                          borderColor: isSelected ? roles.primaryActionBackground : roles.defaultCardBorder,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.sheetOptionLeading,
                          { backgroundColor: isSelected ? roles.primaryActionBackground : roles.iconPrimarySurface },
                        ]}
                      >
                        <AppIcon name="format-list-bulleted" size="sm" color={isSelected ? roles.primaryActionText : roles.iconPrimaryColor} />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.sheetOptionText,
                          { color: isSelected ? roles.primaryActionBackground : roles.headingText },
                          isSelected ? styles.sheetOptionTextSelected : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <View
                        style={[
                          styles.sheetOptionCheck,
                          { borderColor: isSelected ? roles.primaryActionBackground : roles.defaultCardBorder },
                          isSelected ? { backgroundColor: roles.primaryActionBackground } : null,
                        ]}
                      >
                        {isSelected ? <AppIcon name="check" size="sm" color={roles.primaryActionText} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={[styles.emptyState, { backgroundColor: roles.iconPrimarySurface }]}>
                <View style={[styles.emptyStateIcon, { backgroundColor: roles.defaultCardBackground }]}>
                  <AppIcon name="magnify" size="lg" color={roles.iconPrimaryColor} />
                </View>
                <Text style={[styles.emptyStateTitle, { color: roles.headingText }]}>No results found</Text>
                <Text style={[styles.emptyStateBody, { color: roles.bodyText }]}>Try a different search term.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function SignupAddressSection({
  control,
  errors,
  setValue,
  showHeader = true,
  showHelperText = true,
  showTopBorder = true,
  twoColumnMinWidth = 390,
  inputProps = {},
  selectProps = {},
  countryInputProps = {},
  emptyValuePlaceholder = '',
}) {
  const { width } = useWindowDimensions();
  const isWide = width >= twoColumnMinWidth;
  const [activePicker, setActivePicker] = useState('');
  const [region, province, city, barangay, country] = useWatch({
    control,
    name: ['region', 'province', 'city', 'barangay', 'country'],
  });

  const selectedRegion = useMemo(
    () => REGION_OPTIONS.find((item) => normalizeValue(item.name) === normalizeValue(region)),
    [region]
  );

  const provinceOptions = useMemo(() => {
    if (!selectedRegion?.reg_code) return [];
    return sortByName(phil.getProvincesByRegion(selectedRegion.reg_code));
  }, [selectedRegion?.reg_code]);

  const selectedProvince = useMemo(
    () => provinceOptions.find((item) => normalizeValue(item.name) === normalizeValue(province)),
    [province, provinceOptions]
  );

  const cityOptions = useMemo(() => {
    if (!selectedProvince?.prov_code) return [];
    return sortByName(phil.getCityMunByProvince(selectedProvince.prov_code));
  }, [selectedProvince?.prov_code]);

  const selectedCity = useMemo(
    () => cityOptions.find((item) => normalizeValue(item.name) === normalizeValue(city)),
    [city, cityOptions]
  );

  const barangayOptions = useMemo(() => {
    if (!selectedCity?.mun_code) return [];
    return sortByName(phil.getBarangayByMun(selectedCity.mun_code));
  }, [selectedCity?.mun_code]);

  useEffect(() => {
    if (normalizeValue(country) === normalizeValue('Philippines')) {
      return;
    }

    setValue('country', 'Philippines', {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: true,
    });
  }, [country, setValue]);

  const helperText = 'Choose your address step by step. Street or landmark stays manual, while the rest uses free Philippine location data.';

  const pickerOptions = {
    region: toSelectOptions(REGION_OPTIONS, 'reg_code'),
    province: toSelectOptions(provinceOptions, 'prov_code'),
    city: toSelectOptions(cityOptions, 'mun_code'),
    barangay: toSelectOptions(barangayOptions, 'name'),
  };

  const handlePick = (fieldName, option) => {
    if (!option?.value) return;

    if (fieldName === 'region') {
      setValue('region', option.value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('province', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('city', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('barangay', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      return;
    }

    if (fieldName === 'province') {
      setValue('province', option.value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('city', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('barangay', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      return;
    }

    if (fieldName === 'city') {
      setValue('city', option.value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      setValue('barangay', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
      return;
    }

    setValue(fieldName, option.value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  return (
    <View style={[styles.container, !showTopBorder ? styles.containerEmbedded : null]}>
      {showHeader ? (
        <>
          <SectionTitleRow
            title="Address Details"
            icon="file-document-outline"
            color={theme.colors.textPrimary}
            iconColor={theme.colors.textSecondary}
            accentColor={theme.colors.brandPrimary}
            titleStyle={styles.sectionTitle}
          />
          {showHelperText ? <Text style={styles.sectionBody}>{helperText}</Text> : null}
        </>
      ) : showHelperText ? (
        <Text style={styles.compactHelper}>{helperText}</Text>
      ) : null}

      <Controller
        control={control}
        name="street"
        render={({ field }) => (
          <AppInput
            label={fieldConfig.street.label}
            placeholder={emptyValuePlaceholder || fieldConfig.street.placeholder}
            variant="filled"
            helperText={fieldConfig.street.helperText}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.street?.message}
            leftIcon={fieldConfig.street.icon}
            {...inputProps}
          />
        )}
      />

      <View style={styles.fieldRow}>
        <AddressSelectField
          label={fieldConfig.region.label}
          value={region}
          placeholder={emptyValuePlaceholder || fieldConfig.region.placeholder}
          helperText={fieldConfig.region.helperText}
          error={errors.region?.message}
          onPress={() => setActivePicker('region')}
          leftIcon={fieldConfig.region.icon}
          {...selectProps}
        />
      </View>

      <View style={[styles.fieldRow, isWide ? styles.fieldRowWide : null]}>
        <AddressSelectField
          label={fieldConfig.province.label}
          value={province}
          placeholder={emptyValuePlaceholder || fieldConfig.province.placeholder}
          helperText={fieldConfig.province.helperText}
          error={errors.province?.message}
          disabled={!region}
          onPress={() => setActivePicker('province')}
          leftIcon={fieldConfig.province.icon}
          {...selectProps}
        />
        <AddressSelectField
          label={fieldConfig.city.label}
          value={city}
          placeholder={emptyValuePlaceholder || fieldConfig.city.placeholder}
          helperText={fieldConfig.city.helperText}
          error={errors.city?.message}
          disabled={!province}
          onPress={() => setActivePicker('city')}
          leftIcon={fieldConfig.city.icon}
          {...selectProps}
        />
      </View>

      <View style={[styles.fieldRow, isWide ? styles.fieldRowWide : null]}>
        <AddressSelectField
          label={fieldConfig.barangay.label}
          value={barangay}
          placeholder={emptyValuePlaceholder || fieldConfig.barangay.placeholder}
          helperText={fieldConfig.barangay.helperText}
          error={errors.barangay?.message}
          disabled={!city}
          onPress={() => setActivePicker('barangay')}
          leftIcon={fieldConfig.barangay.icon}
          {...selectProps}
        />

        <AppInput
          label={fieldConfig.country.label}
          placeholder={emptyValuePlaceholder || fieldConfig.country.placeholder}
          variant="filled"
          value={country || 'Philippines'}
          editable={false}
          helperText="Country is fixed for this signup flow."
          leftIcon={fieldConfig.country.icon}
          {...inputProps}
          {...countryInputProps}
          style={[isWide ? styles.rowField : null, inputProps?.style, countryInputProps?.style]}
        />
      </View>

      <AddressOptionSheet
        visible={activePicker === 'region'}
        title="Select Region"
        placeholder="Search region"
        options={pickerOptions.region}
        selectedValue={region}
        onClose={() => setActivePicker('')}
        onSelect={(option) => handlePick('region', option)}
      />

      <AddressOptionSheet
        visible={activePicker === 'province'}
        title="Select Province"
        placeholder="Search province"
        options={pickerOptions.province}
        selectedValue={province}
        onClose={() => setActivePicker('')}
        onSelect={(option) => handlePick('province', option)}
      />

      <AddressOptionSheet
        visible={activePicker === 'city'}
        title="Select City / Municipality"
        placeholder="Search city or municipality"
        options={pickerOptions.city}
        selectedValue={city}
        onClose={() => setActivePicker('')}
        onSelect={(option) => handlePick('city', option)}
      />

      <AddressOptionSheet
        visible={activePicker === 'barangay'}
        title="Select Barangay"
        placeholder="Search barangay"
        options={pickerOptions.barangay}
        selectedValue={barangay}
        onClose={() => setActivePicker('')}
        onSelect={(option) => handlePick('barangay', option)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  containerEmbedded: {
    marginTop: 0,
    paddingTop: 0,
    borderTopWidth: 0,
  },
  sectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyLg,
    color: theme.colors.textPrimary,
    lineHeight: theme.typography.compact.bodyLg * theme.typography.lineHeights.snug,
    marginBottom: theme.spacing.xs,
  },
  sectionBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  compactHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  fieldRow: {
    gap: theme.spacing.sm,
  },
  fieldRowWide: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  rowField: {
    flex: 1,
  },
  selectFieldWrap: {
    flex: 1,
    marginBottom: theme.spacing.sm,
    minHeight: 82,
  },
  selectFieldLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.label,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  requiredMark: {
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.bold,
  },
  selectField: {
    minHeight: theme.inputs.minHeightCompact,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceCard,
    overflow: 'hidden',
  },
  selectFieldContent: {
    width: '100%',
    minHeight: theme.inputs.minHeightCompact,
    paddingHorizontal: theme.spacing.inputPaddingXCompact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectFieldPressed: {
    borderColor: theme.colors.borderFocus,
    ...theme.shadows.soft,
  },
  selectFieldDisabled: {
    opacity: 0.55,
  },
  selectFieldError: {
    borderColor: theme.colors.borderError,
  },
  selectFieldValue: {
    flex: 1,
    marginRight: theme.spacing.sm,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    color: theme.colors.textPrimary,
  },
  selectFieldLeftIconWrap: {
    marginRight: theme.spacing.xs,
  },
  selectFieldValueWithIcon: {
    marginLeft: 0,
  },
  selectFieldPlaceholder: {
    color: theme.colors.textMuted,
  },
  selectFieldValueDisabled: {
    color: theme.colors.textDisabled,
  },
  selectFieldHelper: {
    marginTop: 4,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  selectFieldErrorText: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.medium,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16, 10, 14, 0.5)',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetCard: {
    maxHeight: '86%',
    minHeight: '52%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    borderTopWidth: 1,
    borderColor: theme.colors.borderSubtle,
    shadowColor: '#2a1119',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  sheetHandle: {
    width: 54,
    height: 5,
    borderRadius: 99,
    backgroundColor: theme.colors.borderSubtle,
    alignSelf: 'center',
    marginBottom: theme.spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  sheetHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sheetHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
  },
  sheetSubtitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.normal,
  },
  sheetCloseButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    flexShrink: 0,
  },
  sheetCloseSurface: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSearchInput: {
    minHeight: 0,
    marginBottom: theme.spacing.xs,
  },
  sheetSearchShell: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceCard,
    borderColor: theme.colors.borderSubtle,
  },
  sheetSearchText: {
    fontSize: theme.typography.compact.bodySm,
  },
  sheetResultsRow: {
    minHeight: 30,
    marginBottom: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetResultsText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  sheetSelectedPill: {
    maxWidth: '68%',
    minHeight: 28,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSelectedText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  sheetScroll: {
    marginTop: 0,
  },
  sheetScrollContent: {
    paddingBottom: theme.spacing.lg,
  },
  sheetOption: {
    width: '100%',
    minHeight: 58,
    borderRadius: theme.radius.xl,
    marginBottom: 8,
    overflow: 'hidden',
  },
  sheetOptionSurface: {
    width: '100%',
    minHeight: 58,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetOptionLeading: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: theme.spacing.md,
  },
  sheetOptionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: theme.spacing.sm,
  },
  sheetOptionSelected: {
    borderColor: '#9f2f38',
    backgroundColor: '#fdf4f4',
  },
  sheetOptionPressed: {
    opacity: 0.9,
  },
  sheetOptionText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    color: theme.colors.textPrimary,
  },
  sheetOptionTextSelected: {
    fontWeight: theme.typography.weights.semibold,
    color: '#67141c',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xxl,
    borderRadius: 20,
  },
  emptyStateIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  emptyStateTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  emptyStateBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textSecondary,
  },
});

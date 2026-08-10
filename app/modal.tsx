import { Link } from 'expo-router';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { theme } from '../src/design-system/theme';

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>This is a modal</Text>
      <Link href="/" dismissTo style={styles.link}>
        <Text style={styles.linkText}>Go to home screen</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create<{
  container: ViewStyle;
  title: TextStyle;
  link: TextStyle;
  linkText: TextStyle;
}>({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  title: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.sizes.h2,
    fontWeight: theme.typography.weights.bold as TextStyle['fontWeight'],
    color: theme.colors.textPrimary,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.actionTextLink,
  },
});

import { Pressable, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '../../lib/theme';

/** The signed-in stack: case list → case → form, plus settings. */
export default function AppLayout() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.strong,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.page },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: t('cases.title'),
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
              hitSlop={12}
            >
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>
                {t('settings.title')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="case/[id]" options={{ title: '' }} />
      <Stack.Screen name="form/[id]" options={{ title: t('form.title') }} />
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
    </Stack>
  );
}

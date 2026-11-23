import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { LANGUAGES, setLanguage } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { Body, Button, Card, ErrorBox, Field, Screen, Title } from '../components/ui';
import { Mark } from '../components/Logo';

/**
 * Sign-in: company code, employee code (or phone), password. The company
 * code is asked every time because an investigator's identifier is unique
 * only within their company.
 */
export default function Login() {
  const { t, i18n } = useTranslation();
  const { signIn } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [form, setForm] = useState({ tenantCode: '', identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(form);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const other = i18n.language === 'ar' ? 'en' : 'ar';
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ paddingTop: insets.top + 24, alignItems: 'flex-end' }}>
          <Pressable onPress={() => setLanguage(other)} accessibilityRole="button" hitSlop={10}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{LANGUAGES[other]}</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', gap: 10, marginVertical: 24 }}>
          <Mark size={64} color={colors.strong} />
          <Title size={24}>{t('app.name')}</Title>
          <Body muted>{t('app.tagline')}</Body>
        </View>

        <Card>
          <Title>{t('auth.title')}</Title>
          {error && <ErrorBox error={error} />}
          <Field label={t('auth.company')} value={form.tenantCode} onChangeText={set('tenantCode')} autoCapitalize="characters" ltr />
          <Field label={t('auth.identifier')} value={form.identifier} onChangeText={set('identifier')} ltr />
          <Field label={t('auth.password')} value={form.password} onChangeText={set('password')} secure ltr />
          <Button
            title={busy ? t('auth.signingIn') : t('auth.signIn')}
            onPress={submit}
            busy={busy}
            disabled={!form.tenantCode || !form.identifier || !form.password}
          />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

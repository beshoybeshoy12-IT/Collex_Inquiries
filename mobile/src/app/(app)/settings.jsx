import { Alert, Platform, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { API_URL } from '../../lib/api';
import { LANGUAGES, localised, setLanguage } from '../../lib/i18n';
import { useColors } from '../../lib/theme';
import { Body, Button, Card, Label, Row, Screen, Title } from '../../components/ui';

/** Language, who is signed in, which server, and sign-out. */
export default function Settings() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const { investigator, signOut } = useAuth();

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(t('auth.signOutConfirm'))) signOut();
      return;
    }
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <Screen>
      <Card>
        <Title size={16}>{t('settings.language')}</Title>
        <Row>
          {Object.entries(LANGUAGES).map(([code, name]) => {
            const on = i18n.language === code;
            return (
              <Pressable
                key={code}
                onPress={() => setLanguage(code)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primarySoft : colors.surface,
                }}
              >
                <Body style={{ fontWeight: on ? '700' : '400', color: on ? colors.primaryStrong : colors.text }}>{name}</Body>
              </Pressable>
            );
          })}
        </Row>
        {Platform.OS !== 'web' && <Label>{t('settings.languageRestart')}</Label>}
      </Card>

      <Card>
        <Title size={16}>{t('settings.account')}</Title>
        <Body>{investigator?.fullName}</Body>
        <Label>{investigator?.employeeCode}</Label>
        <Label>{localised(investigator?.tenant, i18n.language)}</Label>
      </Card>

      <Card>
        <Title size={16}>{t('settings.server')}</Title>
        <View>
          <Body muted style={{ writingDirection: 'ltr' }}>{API_URL}</Body>
        </View>
      </Card>

      <Button title={t('auth.signOut')} tone="danger" onPress={confirmSignOut} />
    </Screen>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../../lib/api';
import { local } from '../../../lib/storage';
import { useColors } from '../../../lib/theme';
import { Body, Button, Card, ErrorBox, Label, Loading, Row, Screen, Title } from '../../../components/ui';
import FormFields from '../../../components/FormFields';

const RESULTS = ['POSITIVE', 'NEGATIVE', 'PARTIAL', 'NOT_FOUND', 'REFUSED', 'UNREACHABLE'];

const draftKey = (id) => `collex-field-draft-${id}`;
const submitKey = (id) => `collex-field-submit-${id}`;

function ask(title, message) {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]),
  );
}

function notify(message) {
  if (Platform.OS === 'web') globalThis.alert?.(message);
  else Alert.alert(message);
}

/**
 * Filling in the case's form.
 *
 * WORKS WITHOUT COVERAGE. Every change is kept on the phone at once; "save
 * draft" also sends it to the server when it can, and says plainly when it
 * could not. Opening the form again restores the phone's copy if it is newer
 * than the server's.
 *
 * SUBMITTING TWICE IS SAFE. A submission id is made once per attempt and
 * stored with it; a retry after a lost response sends the same id, and the
 * server returns the first result instead of recording a second attempt.
 */
export default function FormScreen() {
  const { id } = useLocalSearchParams();
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState('');
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(null);
  const restored = useRef(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-form', id],
    queryFn: async () => (await api.get(`/forms/investigation/${id}`)).data,
    retry: false,
  });

  // Start from the server's draft, unless the phone holds a newer one.
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    (async () => {
      const saved = await local.getJson(draftKey(id));
      const server = data.submission?.status === 'DRAFT' ? data.submission : null;
      const serverTime = server ? Date.parse(server.updatedAt) : 0;
      if (saved && saved.savedAt > serverTime) setAnswers(saved.answers ?? {});
      else setAnswers(server?.answers ?? {});
    })();
  }, [data, id]);

  const change = (key, value) => {
    setAnswers((current) => {
      const next = { ...current, [key]: value };
      local.setJson(draftKey(id), { answers: next, savedAt: Date.now() });
      return next;
    });
  };

  const saveDraft = async () => {
    setBusy('draft');
    try {
      await api.patch(`/forms/investigation/${id}/draft`, { answers });
      notify(t('form.draftSaved'));
    } catch (failure) {
      notify(failure.friendlyMessage === 'NETWORK' ? t('form.draftSavedOffline') : localiseServerMessage(failure.friendlyMessage, i18n.language));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!(await ask(t('form.submit'), t('form.submitConfirm')))) return;
    setBusy('submit');
    setProblems([]);
    try {
      let pending = await local.getJson(submitKey(id));
      if (!pending) {
        pending = { clientSubmissionId: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
        await local.setJson(submitKey(id), pending);
      }
      const { data: outcome } = await api.post(`/forms/investigation/${id}/submit`, {
        answers,
        ...(result ? { result } : {}),
        clientSubmissionId: pending.clientSubmissionId,
      });
      await local.remove(submitKey(id));
      await local.remove(draftKey(id));
      queryClient.invalidateQueries({ queryKey: ['case', id] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments'] });

      const failedChecks = outcome?.autoValidation?.passed === false;
      notify(
        failedChecks
          ? t('form.autoFailed') +
              (outcome.autoValidation.problems ?? [])
                .map((p) => (i18n.language === 'ar' ? p.reasonAr : p.reasonEn))
                .join('، ')
          : t('form.submitted'),
      );
      router.back();
    } catch (failure) {
      const list = failure.details?.problems;
      if (Array.isArray(list)) {
        setProblems(list);
        notify(t('form.incomplete'));
      } else {
        // Keep the submission id: a retry must be recognised as the same one.
        notify(
          failure.friendlyMessage === 'NETWORK'
            ? t('common.networkError')
            : localiseServerMessage(failure.friendlyMessage, i18n.language),
        );
        if (failure.response) await local.remove(submitKey(id));
      }
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <Loading />;
  if (error) {
    return (
      <Screen>
        {error.response?.status === 404 ? (
          <Card>
            <Body muted>{t('form.noForm')}</Body>
          </Card>
        ) : (
          <ErrorBox error={error} onRetry={refetch} />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{i18n.language === 'ar' ? data.nameAr : data.nameEn}</Title>

      <FormFields schema={data.schema} answers={answers} onChange={change} problems={problems} />

      <Card>
        <Label>{t('form.result')}</Label>
        <Row>
          {RESULTS.map((value) => {
            const on = result === value;
            return (
              <Pressable
                key={value}
                onPress={() => setResult(on ? '' : value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={{
                  minHeight: 40,
                  paddingHorizontal: 14,
                  justifyContent: 'center',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primarySoft : colors.surface,
                }}
              >
                <Body style={{ fontSize: 14, color: on ? colors.primaryStrong : colors.text }}>
                  {t(`result.${value}`)}
                </Body>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <View style={{ gap: 10 }}>
        <Button title={t('form.saveDraft')} tone="outline" busy={busy === 'draft'} disabled={Boolean(busy)} onPress={saveDraft} />
        <Button title={t('form.submit')} tone="success" busy={busy === 'submit'} disabled={Boolean(busy)} onPress={submit} />
      </View>
    </Screen>
  );
}

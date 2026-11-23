import { useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../lib/api';
import { localised } from '../../lib/i18n';
import { statusTone, useColors } from '../../lib/theme';
import { Body, Button, Card, ErrorBox, Field, Label, Loading, Pill, Row, Title } from '../../components/ui';

/**
 * "My cases": the investigator's current assignments, newest offers first.
 *
 * An offer waiting for an answer shows Accept / Decline right on the card —
 * that is the decision the investigator opens the app to make. Everything
 * else opens the case.
 */
export default function Cases() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['my-assignments'],
    queryFn: async () => (await api.get('/assignments/my')).data,
  });

  const respond = useMutation({
    mutationFn: async ({ id, accept, why }) =>
      (await api.post(`/assignments/${id}/respond`, { accept, ...(why ? { reason: why } : {}) })).data,
    onSuccess: () => {
      setDeclining(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['my-assignments'] });
    },
    onError: (failure) => {
      const message = localiseServerMessage(failure.friendlyMessage, i18n.language);
      if (Platform.OS === 'web') globalThis.alert?.(message);
      else Alert.alert(t('common.error'), message);
    },
  });

  if (isLoading) return <Loading />;

  const assignments = (Array.isArray(data) ? data : (data?.data ?? []))
    .slice()
    .sort((a, b) => (a.status === 'PENDING' ? -1 : 0) - (b.status === 'PENDING' ? -1 : 0));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      {error && <ErrorBox error={error} onRetry={refetch} />}

      {!error && assignments.length === 0 && (
        <Card>
          <Body muted>{t('cases.none')}</Body>
        </Card>
      )}

      {assignments.map((assignment) => {
        const c = assignment.investigation ?? {};
        const pending = assignment.status === 'PENDING';
        return (
          <Pressable
            key={assignment.id}
            onPress={() =>
              router.push({ pathname: '/case/[id]', params: { id: c.id, assignmentId: assignment.id } })
            }
            accessibilityRole="button"
          >
            <Card style={pending ? { borderColor: colors.warning } : undefined}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Title size={16}>{c.customer?.fullName}</Title>
                <Pill text={t(`status.${c.status}`, c.status)} tone={statusTone(c.status)} />
              </Row>
              <Label>{c.caseNumber}</Label>
              <Body muted>
                {localised(c.investigationType, i18n.language)} · {localised(c.product, i18n.language)}
              </Body>
              {(c.addressLine || c.city) && (
                <Body>
                  {[c.addressLine, localised(c.city, i18n.language), localised(c.governorate, i18n.language)]
                    .filter(Boolean)
                    .join('، ')}
                </Body>
              )}
              {c.dueAt && (
                <Label>
                  {t('cases.due')}: {new Date(c.dueAt).toLocaleString(i18n.language)}
                </Label>
              )}

              {pending && (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Pill text={t('cases.pendingOffer')} tone="warning" />
                  {declining === assignment.id ? (
                    <>
                      <Field label={t('cases.declineReason')} value={reason} onChangeText={setReason} multiline autoCapitalize="sentences" />
                      <Row>
                        <View style={{ flex: 1 }}>
                          <Button title={t('common.cancel')} tone="outline" onPress={() => setDeclining(null)} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={t('cases.decline')}
                            tone="danger"
                            busy={respond.isPending}
                            disabled={!reason.trim()}
                            onPress={() => respond.mutate({ id: assignment.id, accept: false, why: reason.trim() })}
                          />
                        </View>
                      </Row>
                    </>
                  ) : (
                    <Row>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t('cases.accept')}
                          busy={respond.isPending}
                          onPress={() => respond.mutate({ id: assignment.id, accept: true })}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button title={t('cases.decline')} tone="outline" onPress={() => setDeclining(assignment.id)} />
                      </View>
                    </Row>
                  )}
                </View>
              )}
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

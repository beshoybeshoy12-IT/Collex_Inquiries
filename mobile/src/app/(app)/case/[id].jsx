import { useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import api, { localiseServerMessage } from '../../../lib/api';
import { localised } from '../../../lib/i18n';
import { checkIn, uploadPhoto } from '../../../lib/field';
import { statusTone, useColors } from '../../../lib/theme';
import { Body, Button, Card, ErrorBox, Label, Loading, Pill, Row, Screen, Title } from '../../../components/ui';

/** The forward moves an investigator makes from this screen, in order. */
const FORWARD = ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'];
/** Where the form may be opened. */
const FORM_OPEN = ['ON_SITE', 'IN_PROGRESS', 'REWORK'];

function notify(title, message) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
}

/**
 * One case, as the investigator needs it at the door: who, where, the next
 * step as one big button, GPS check-in, photos, and the form.
 *
 * The buttons come from `allowedTransitions`, which the server computes for
 * this investigator — the app never decides on its own what is allowed.
 */
export default function CaseScreen() {
  const { id } = useLocalSearchParams();
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState(null);

  const caseQuery = useQuery({
    queryKey: ['case', id],
    queryFn: async () => (await api.get(`/investigations/${id}`)).data,
  });
  const mediaQuery = useQuery({
    queryKey: ['case-media', id],
    queryFn: async () => (await api.get('/media', { params: { investigationId: id } })).data,
  });
  const categoriesQuery = useQuery({
    queryKey: ['media-categories'],
    queryFn: async () => (await api.get('/media/categories/all', { params: { activeOnly: true } })).data,
    staleTime: 10 * 60_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['case', id] });
    queryClient.invalidateQueries({ queryKey: ['my-assignments'] });
  };
  const failed = (failure) =>
    notify(
      t('common.error'),
      failure?.friendlyMessage === 'NETWORK'
        ? t('common.networkError')
        : localiseServerMessage(failure?.friendlyMessage, i18n.language),
    );

  const move = useMutation({
    mutationFn: async (status) => (await api.post(`/investigations/${id}/transition`, { status })).data,
    onSuccess: refresh,
    onError: failed,
  });

  const gps = useMutation({
    mutationFn: () => checkIn(id),
    onSuccess: () => {
      notify(t('cases.checkedIn'));
      queryClient.invalidateQueries({ queryKey: ['case', id] });
    },
    onError: (failure) =>
      failure?.code === 'LOCATION_DENIED' ? notify(t('cases.locationDenied')) : failed(failure),
  });

  const photo = useMutation({
    mutationFn: async (source) => {
      const options = { mediaTypes: ['images'], quality: 0.7 };
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return null;
      }
      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled || !picked.assets?.length) return null;
      return uploadPhoto({ asset: picked.assets[0], investigationId: id, categoryCode: category ?? undefined });
    },
    onSuccess: (result) => {
      if (!result) return;
      notify(t('cases.uploaded'));
      queryClient.invalidateQueries({ queryKey: ['case-media', id] });
    },
    onError: failed,
  });

  if (caseQuery.isLoading) return <Loading />;
  if (caseQuery.error) {
    return (
      <Screen>
        <ErrorBox error={caseQuery.error} onRetry={caseQuery.refetch} />
      </Screen>
    );
  }

  const c = caseQuery.data;
  const customer = c.customer ?? {};
  const allowed = c.allowedTransitions ?? [];
  const next = FORWARD.find((status) => allowed.includes(status));
  const phone = customer.mobile || customer.altMobile;
  const address = [c.addressLine, localised(c.district), localised(c.city), localised(c.governorate)]
    .filter(Boolean)
    .join('، ');
  const media = Array.isArray(mediaQuery.data) ? mediaQuery.data : (mediaQuery.data?.data ?? []);
  const categories = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];
  const required = c.investigationType?.requiredPhotoCategories ?? [];

  const openMap = () => {
    const target =
      c.targetLat && c.targetLng ? `${c.targetLat},${c.targetLng}` : encodeURIComponent(address);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${target}`);
  };

  const openForm = async () => {
    // The form is filled in IN_PROGRESS; arriving there from ON_SITE or a
    // rework is the investigator starting it, so make that move first.
    if (c.status !== 'IN_PROGRESS' && allowed.includes('IN_PROGRESS')) {
      try {
        await move.mutateAsync('IN_PROGRESS');
      } catch {
        return;
      }
    }
    router.push({ pathname: '/form/[id]', params: { id } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: c.caseNumber }} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Title>{customer.fullName}</Title>
          <Pill text={t(`status.${c.status}`, c.status)} tone={statusTone(c.status)} />
        </Row>
        <Body muted>
          {localised(c.investigationType, i18n.language)} · {localised(c.product, i18n.language)}
        </Body>
        {c.dueAt && (
          <Label>
            {t('cases.due')}: {new Date(c.dueAt).toLocaleString(i18n.language)}
          </Label>
        )}
      </Card>

      <Card>
        <Label>{t('cases.address')}</Label>
        <Body>{address || '—'}</Body>
        <Row>
          <View style={{ flex: 1 }}>
            <Button title={t('cases.openMap')} tone="outline" onPress={openMap} />
          </View>
          {phone ? (
            <View style={{ flex: 1 }}>
              <Button title={t('cases.call')} tone="outline" onPress={() => Linking.openURL(`tel:${phone}`)} />
            </View>
          ) : null}
        </Row>
      </Card>

      {(next || FORM_OPEN.includes(c.status)) && (
        <Card>
          <Label>{t('cases.nextStep')}</Label>
          {next && next !== 'IN_PROGRESS' && (
            <Button title={t(`action.${next}`)} busy={move.isPending} onPress={() => move.mutate(next)} />
          )}
          {['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'REWORK'].includes(c.status) && (
            <Button
              title={t('cases.checkIn')}
              tone="outline"
              busy={gps.isPending}
              onPress={() => gps.mutate()}
            />
          )}
          {FORM_OPEN.includes(c.status) && (
            <Button title={t('cases.fillForm')} tone="success" busy={move.isPending} onPress={openForm} />
          )}
        </Card>
      )}

      <Card>
        <Title size={16}>{t('cases.photos')}</Title>
        {required.length > 0 && (
          <Label>
            {t('cases.requiredPhotos')}: {required.join('، ')}
          </Label>
        )}

        {categories.length > 0 && (
          <View style={{ gap: 6 }}>
            <Label>{t('cases.category')}</Label>
            <Row>
              {categories.map((cat) => {
                const active = category === cat.code;
                return (
                  <Pressable
                    key={cat.code}
                    onPress={() => setCategory(active ? null : cat.code)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primarySoft : colors.surface,
                    }}
                  >
                    <Body style={{ fontSize: 13, color: active ? colors.primaryStrong : colors.text }}>
                      {localised(cat, i18n.language)}
                    </Body>
                  </Pressable>
                );
              })}
            </Row>
          </View>
        )}

        <Row>
          <View style={{ flex: 1 }}>
            <Button
              title={photo.isPending ? t('cases.uploading') : t('cases.addPhoto')}
              busy={photo.isPending}
              onPress={() => photo.mutate('camera')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('cases.fromGallery')}
              tone="outline"
              disabled={photo.isPending}
              onPress={() => photo.mutate('library')}
            />
          </View>
        </Row>

        <Row>
          {media.map((item) => (
            <MediaThumb key={item.id} asset={item} />
          ))}
        </Row>
      </Card>
    </Screen>
  );
}

/** A thumbnail: the server hands out a short-lived URL per asset. */
function MediaThumb({ asset }) {
  const colors = useColors();
  const { data } = useQuery({
    queryKey: ['media-url', asset.id],
    queryFn: async () => (await api.get(`/media/${asset.id}/download`)).data,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return (
    <View
      style={{
        width: 84,
        height: 84,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {data?.url ? <Image source={{ uri: data.url }} style={{ width: '100%', height: '100%' }} /> : null}
    </View>
  );
}

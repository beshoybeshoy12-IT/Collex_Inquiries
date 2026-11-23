import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import api, { setSessionLostHandler, tokens } from './api';
import { secure } from './storage';

/**
 * The investigator's session.
 *
 * Sign-in is `POST /auth/investigator/login` — the one investigator-specific
 * route. Everything after it uses the same routes the office does; the
 * server narrows each to "your own cases" from the token.
 */
const PROFILE = 'collex-field-profile';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [investigator, setInvestigator] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [profile, access] = await Promise.all([secure.get(PROFILE), tokens.access()]);
      if (profile && access) setInvestigator(JSON.parse(profile));
      setReady(true);
    })();
  }, []);

  const forget = useCallback(async () => {
    await tokens.clear();
    await secure.remove(PROFILE);
    setInvestigator(null);
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      secure.remove(PROFILE);
      setInvestigator(null);
    });
  }, []);

  const signIn = useCallback(async ({ tenantCode, identifier, password }) => {
    const { data } = await api.post('/auth/investigator/login', {
      tenantCode: tenantCode.trim().toUpperCase(),
      identifier: identifier.trim(),
      password,
      deviceModel: Device.modelName ?? undefined,
      devicePlatform: Platform.OS,
    });
    await tokens.save(data);
    await secure.set(PROFILE, JSON.stringify(data.investigator));
    setInvestigator(data.investigator);
    // Not awaited: a phone that cannot receive push still works.
    registerForPush().catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Offline or already expired: the local session ends either way.
    }
    await forget();
  }, [forget]);

  const value = useMemo(
    () => ({ investigator, ready, signIn, signOut }),
    [investigator, ready, signIn, signOut],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Register this handset for push notifications (new assignment, rework).
 *
 * The native FCM/APNs token, not an Expo push token: the server's push
 * driver talks to the platforms directly. Best effort by design — Expo Go on
 * Android has no remote push since SDK 53, the web preview has none, and a
 * refused permission is the investigator's call. None of those stop work.
 */
async function registerForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      // Exported at runtime through an `export *` the import plugin cannot
      // follow (checked in node_modules/expo-notifications/build/index.js).
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const status =
    current.status === 'granted'
      ? current.status
      : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;

  const { data: token } = await Notifications.getDevicePushTokenAsync();
  await api.post('/notifications/devices', {
    token: String(token),
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    appVersion: Constants.expoConfig?.version,
    deviceModel: Device.modelName ?? undefined,
    osVersion: Device.osVersion ?? undefined,
  });
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where the session lives.
 *
 * On a phone, the tokens go in the OS keychain/keystore (expo-secure-store),
 * never in plain AsyncStorage: a refresh token is a password for this account
 * until it expires. SecureStore does not exist in a browser, so the web build
 * — used only to preview the app during development — falls back to
 * localStorage, the same place the office web client keeps its own.
 */
const web = Platform.OS === 'web';

export const secure = {
  async get(key) {
    if (web) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (web) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Private browsing: the session lasts for this tab only.
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    if (web) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Nothing to clear.
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/** Non-secret local data: form drafts waiting for a connection, preferences. */
export const local = {
  async getJson(key, fallback = null) {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  async setJson(key, value) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    await AsyncStorage.removeItem(key);
  },
};

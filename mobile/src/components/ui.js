import { createElement as h } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '../lib/theme';
import { localiseServerMessage } from '../lib/api';

/**
 * The handful of building blocks every screen uses. Plain React Native, no UI
 * kit: fewer dependencies to keep in step with each Expo SDK, and full
 * control of right-to-left layout (`start`/`end`, never `left`/`right`).
 *
 * Written with createElement so this file stays .js; screens use JSX.
 */

export function Screen({ children, scroll = true, padded = true }) {
  const c = useColors();
  const style = [{ flex: 1, backgroundColor: c.page }];
  const content = { padding: padded ? 16 : 0, gap: 12, paddingBottom: 40 };
  return scroll
    ? h(ScrollView, { style, contentContainerStyle: content, keyboardShouldPersistTaps: 'handled' }, children)
    : h(View, { style: [style, content] }, children);
}

export function Card({ children, style }) {
  const c = useColors();
  return h(
    View,
    {
      style: [
        { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
        style,
      ],
    },
    children,
  );
}

export function Title({ children, size = 18 }) {
  const c = useColors();
  return h(Text, { style: { color: c.strong, fontSize: size, fontWeight: '700', textAlign: 'auto' } }, children);
}

export function Label({ children }) {
  const c = useColors();
  return h(Text, { style: { color: c.muted, fontSize: 12, fontWeight: '600' } }, children);
}

export function Body({ children, muted, style }) {
  const c = useColors();
  return h(Text, { style: [{ color: muted ? c.muted : c.text, fontSize: 15, lineHeight: 22 }, style] }, children);
}

const TONES = {
  primary: (c) => ({ bg: c.primary, fg: c.primaryText, border: c.primary }),
  outline: (c) => ({ bg: c.surface, fg: c.text, border: c.border }),
  success: (c) => ({ bg: c.success, fg: '#ffffff', border: c.success }),
  danger: (c) => ({ bg: c.surface, fg: c.danger, border: c.danger }),
};

export function Button({ title, onPress, tone = 'primary', disabled, busy, icon }) {
  const c = useColors();
  const t = TONES[tone](c);
  return h(
    Pressable,
    {
      onPress,
      disabled: disabled || busy,
      accessibilityRole: 'button',
      accessibilityState: { disabled: Boolean(disabled || busy), busy: Boolean(busy) },
      style: ({ pressed }) => ({
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.bg,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
      }),
    },
    busy ? h(ActivityIndicator, { color: t.fg }) : null,
    icon ? h(Text, { style: { color: t.fg, fontSize: 16 } }, icon) : null,
    h(Text, { style: { color: t.fg, fontSize: 16, fontWeight: '600' } }, title),
  );
}

export function Field({ label, value, onChangeText, secure, multiline, keyboardType, autoCapitalize = 'none', placeholder, ltr }) {
  const c = useColors();
  return h(
    View,
    { style: { gap: 6 } },
    label ? h(Label, null, label) : null,
    h(TextInput, {
      value: value ?? '',
      onChangeText,
      secureTextEntry: secure,
      multiline,
      keyboardType,
      autoCapitalize,
      placeholder,
      placeholderTextColor: c.muted,
      style: {
        minHeight: multiline ? 96 : 48,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.strong,
        backgroundColor: c.surface,
        fontSize: 16,
        textAlignVertical: multiline ? 'top' : 'center',
        writingDirection: ltr ? 'ltr' : undefined,
        textAlign: ltr ? 'left' : undefined,
      },
    }),
  );
}

export function Pill({ text, tone = 'primary' }) {
  const c = useColors();
  const map = {
    primary: [c.primarySoft, c.primaryStrong],
    success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger],
    warning: [c.warningSoft, c.warning],
  };
  const [bg, fg] = map[tone] ?? map.primary;
  return h(
    View,
    { style: { alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 } },
    h(Text, { style: { color: fg, fontSize: 12, fontWeight: '700' } }, text),
  );
}

export function Loading() {
  const c = useColors();
  return h(View, { style: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: c.page } }, h(ActivityIndicator, { color: c.primary, size: 'large' }));
}

/** A failure the investigator can act on: the server's message, and a retry. */
export function ErrorBox({ error, onRetry }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const message =
    error?.friendlyMessage === 'NETWORK'
      ? t('common.networkError')
      : localiseServerMessage(error?.friendlyMessage, i18n.language) || t('common.error');
  return h(
    Card,
    { style: { borderColor: c.danger, backgroundColor: c.dangerSoft } },
    h(Body, { style: { color: c.danger } }, message),
    onRetry ? h(Button, { title: t('common.retry'), tone: 'outline', onPress: onRetry }) : null,
  );
}

export function Row({ children, style }) {
  return h(View, { style: [styles.row, style] }, children);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});

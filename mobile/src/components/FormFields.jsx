import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localised } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { currentPoint } from '../lib/field';
import { Body, Button, Card, Field, Label, Row, Title } from './ui';

/**
 * Renders a published form schema (server/src/forms/form-schema.ts) for
 * filling in on a phone. Nothing here knows the residence or work form: a
 * tenant's new form in the builder works here without an app release.
 *
 * Visibility follows the same declarative `visibleWhen` rules as the server's
 * validator, so a hidden field is never reported as missing.
 *
 * Photo, file and signature fields are filled from the case's photo section
 * (the evidence the automatic check counts), not inline.
 */
export default function FormFields({ schema, answers, onChange, problems = [] }) {
  const { i18n } = useTranslation();
  const problemFor = (key) => problems.find((p) => p.field === key);

  return (schema?.sections ?? [])
    .filter((section) => conditionsMet(section.visibleWhen, answers))
    .map((section) => (
      <Card key={section.key}>
        <Title size={16}>{localised(section, i18n.language)}</Title>
        {(section.fields ?? [])
          .filter((field) => conditionsMet(field.visibleWhen, answers))
          .map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={answers[field.key]}
              onChange={(value) => onChange(field.key, value)}
              problem={problemFor(field.key)}
            />
          ))}
      </Card>
    ));
}

const TEXT_TYPES = ['TEXT', 'ADDRESS', 'NUMBER', 'DATE', 'TIME', 'DATETIME'];
const SINGLE = ['RADIO', 'DROPDOWN'];
const MULTI = ['CHECKBOX', 'MULTI_SELECT'];

function FieldInput({ field, value, onChange, problem }) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const label = `${localised(field, i18n.language)}${field.required ? ' *' : ''}`;
  const problemText = problem
    ? i18n.language === 'ar'
      ? problem.reasonAr
      : problem.reasonEn
    : null;

  let input;

  if (field.type === 'SECTION_NOTE') {
    return <Body muted>{localised(field, i18n.language)}</Body>;
  }

  if (field.type === 'LONG_TEXT') {
    input = <Field label={label} value={value} onChangeText={onChange} multiline autoCapitalize="sentences" />;
  } else if (TEXT_TYPES.includes(field.type)) {
    const placeholder =
      field.type === 'DATE' ? t('form.pickDate') : field.type === 'TIME' ? t('form.pickTime') : undefined;
    input = (
      <Field
        label={label}
        value={value == null ? '' : String(value)}
        onChangeText={(text) => onChange(field.type === 'NUMBER' && text !== '' ? Number(text) : text)}
        keyboardType={field.type === 'NUMBER' ? 'numeric' : undefined}
        autoCapitalize="sentences"
        placeholder={placeholder}
        ltr={['NUMBER', 'DATE', 'TIME', 'DATETIME'].includes(field.type)}
      />
    );
  } else if (SINGLE.includes(field.type) || MULTI.includes(field.type)) {
    const multi = MULTI.includes(field.type);
    const selected = multi ? (Array.isArray(value) ? value : []) : value;
    input = (
      <View style={{ gap: 6 }}>
        <Label>{label}</Label>
        <Row>
          {(field.options ?? []).map((option) => {
            const on = multi ? selected.includes(option.value) : selected === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole={multi ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on }}
                onPress={() => {
                  if (multi) {
                    onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
                  } else {
                    onChange(on ? '' : option.value);
                  }
                }}
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
                <Body style={{ fontSize: 14, color: on ? colors.primaryStrong : colors.text, fontWeight: on ? '700' : '400' }}>
                  {localised(option, i18n.language)}
                </Body>
              </Pressable>
            );
          })}
        </Row>
      </View>
    );
  } else if (field.type === 'RATING') {
    const scale = field.scale ?? 5;
    input = (
      <View style={{ gap: 6 }}>
        <Label>{label}</Label>
        <Row>
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <Pressable
              key={n}
              onPress={() => onChange(value === n ? '' : n)}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === n }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: value >= n ? colors.primary : colors.border,
                backgroundColor: value >= n ? colors.primarySoft : colors.surface,
              }}
            >
              <Body>{n}</Body>
            </Pressable>
          ))}
        </Row>
      </View>
    );
  } else if (field.type === 'GPS') {
    input = (
      <View style={{ gap: 6 }}>
        <Label>{label}</Label>
        {value?.lat ? (
          <Body>
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </Body>
        ) : null}
        <Button
          title={t('cases.checkIn')}
          tone="outline"
          onPress={async () => {
            try {
              onChange(await currentPoint());
            } catch {
              // Permission refused: the field stays empty and says so on submit.
            }
          }}
        />
      </View>
    );
  } else {
    // PHOTO / FILE / SIGNATURE / TABLE / REPEATER
    input = (
      <View style={{ gap: 4 }}>
        <Label>{label}</Label>
        <Body muted>{t('form.photoField')}</Body>
      </View>
    );
  }

  return (
    <View style={{ gap: 4 }}>
      {input}
      {problemText ? <Body style={{ color: colors.danger, fontSize: 13 }}>{problemText}</Body> : null}
    </View>
  );
}

/** Mirrors `isVisible` in server/src/forms/form-schema.ts. */
export function conditionsMet(conditions, answers) {
  if (!conditions?.length) return true;
  const comparable = (v) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));
  const empty = (v) =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

  return conditions.every((c) => {
    const actual = answers[c.field];
    switch (c.operator) {
      case 'EQUALS':
        return comparable(actual) === comparable(c.value);
      case 'NOT_EQUALS':
        return comparable(actual) !== comparable(c.value);
      case 'IN':
        return Array.isArray(c.value) && c.value.map(comparable).includes(comparable(actual));
      case 'NOT_IN':
        return Array.isArray(c.value) && !c.value.map(comparable).includes(comparable(actual));
      case 'IS_EMPTY':
        return empty(actual);
      case 'IS_NOT_EMPTY':
        return !empty(actual);
      default:
        return true;
    }
  });
}

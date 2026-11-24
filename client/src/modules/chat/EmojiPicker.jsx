import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOJI_CATEGORIES, KEYWORDS, searchEmoji } from './emojiData';

const RECENT_KEY = 'ci-chat-recent-emoji';
const COLUMNS = 8;

function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, 24) : [];
  } catch {
    return [];
  }
}

function saveRecent(emoji) {
  try {
    const next = [emoji, ...readRecent().filter((item) => item !== emoji)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: recents are a convenience.
  }
}

/**
 * The emoji picker: search (Arabic or English), categories, and the ones you
 * used last. Fully keyboard-operable — arrows move through the grid, Enter
 * picks, Escape closes — and every emoji has a spoken name.
 *
 * @param {{ onPick: (emoji: string) => void, onClose: () => void }} props
 */
export default function EmojiPicker({ onPick, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(readRecent);
  const [category, setCategory] = useState(recent.length ? 'recent' : EMOJI_CATEGORIES[0].key);
  const searchRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const shown = useMemo(() => {
    if (query.trim()) return searchEmoji(query);
    if (category === 'recent') return recent;
    return EMOJI_CATEGORIES.find((item) => item.key === category)?.emojis ?? [];
  }, [query, category, recent]);

  const pick = (emoji) => {
    saveRecent(emoji);
    setRecent(readRecent());
    onPick(emoji);
  };

  // Roving focus through the grid with the arrow keys.
  const onGridKey = (event) => {
    const buttons = [...(gridRef.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const rtl = document.documentElement.dir === 'rtl';
    const step = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, index + step))];
    next?.focus();
  };

  const tabs = [
    ...(recent.length ? [{ key: 'recent', icon: '🕘' }] : []),
    ...EMOJI_CATEGORIES,
  ];

  return (
    <div
      className="emoji-picker"
      role="dialog"
      aria-label={t('chat.emoji.title')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        ref={searchRef}
        type="search"
        className="form-control form-control-sm emoji-picker__search"
        placeholder={t('chat.emoji.search')}
        aria-label={t('chat.emoji.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            gridRef.current?.querySelector('button')?.focus();
          }
        }}
      />

      {!query.trim() && (
        <div className="emoji-picker__tabs" role="tablist" aria-label={t('chat.emoji.categories')}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={category === tab.key}
              aria-label={t(`chat.emoji.cat.${tab.key}`)}
              title={t(`chat.emoji.cat.${tab.key}`)}
              className={category === tab.key ? 'is-active' : ''}
              onClick={() => setCategory(tab.key)}
            >
              <span aria-hidden="true">{tab.icon}</span>
            </button>
          ))}
        </div>
      )}

      <div className="emoji-picker__label" aria-live="polite">
        {query.trim()
          ? t('chat.emoji.results', { count: shown.length })
          : t(`chat.emoji.cat.${category}`)}
      </div>

      <div
        ref={gridRef}
        className="emoji-picker__grid"
        role="group"
        aria-label={t('chat.emoji.title')}
        onKeyDown={onGridKey}
      >
        {shown.map((emoji) => {
          const name = (KEYWORDS[emoji] ?? '').split(' ')[0] || emoji;
          return (
            <button
              key={emoji}
              type="button"
              className="emoji-picker__item"
              aria-label={name}
              title={name}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="emoji-picker__empty">{t('chat.emoji.none')}</p>
        )}
      </div>
    </div>
  );
}

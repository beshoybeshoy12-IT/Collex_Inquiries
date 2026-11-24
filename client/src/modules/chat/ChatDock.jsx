import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useToast } from '../../components/Toast';
import EmojiPicker from './EmojiPicker';
import {
  fetchChatFile,
  useChatFileUrl,
  useChatSignals,
  useChatUnread,
  useContacts,
  useConversations,
  useMessages,
} from './useChat';

const STATE_KEY = 'ci-chat-dock';
const MAX_BODY = 4000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,' +
  '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,audio/*,video/mp4,video/webm';

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the dock just opens closed next time.
  }
}

function initialsOf(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The floating chat — a launcher in the corner and a window over the page.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  It floats so a conversation can stay open while working a case. Built to
 *  ISO 9241 / WCAG 2.1 AA (ISO/IEC 40500) expectations:
 *    - every control is reachable and usable from the keyboard, with a visible
 *      focus ring; Escape closes the innermost layer and returns focus;
 *    - the thread is an ARIA log, so a screen reader announces new messages;
 *      every icon button has a spoken name;
 *    - colours come from the theme tokens (contrast in light and dark), and
 *      motion is dropped for people who ask for reduced motion;
 *    - layout uses logical properties, so Arabic and English both read right.
 *  Security (ISO 27001) is the server's job — tenant scoping, participant-only
 *  reads, files checked by their bytes, audited downloads, retention — and
 *  nothing here is trusted for any of it.
 */
export default function ChatDock() {
  const { t, i18n } = useTranslation();
  const saved = useMemo(readState, []);
  const [open, setOpen] = useState(Boolean(saved.open));
  const [view, setView] = useState(saved.conversationId ? 'thread' : 'list');
  const [conversationId, setConversationId] = useState(saved.conversationId ?? null);
  const launcherRef = useRef(null);
  const panelRef = useRef(null);

  useChatSignals();
  const { data: unread } = useChatUnread();
  const unreadCount = unread?.unread ?? 0;

  useEffect(() => {
    saveState({ open, conversationId: view === 'thread' ? conversationId : null });
  }, [open, view, conversationId]);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const openThread = (id) => {
    setConversationId(id);
    setView('thread');
  };

  const title = t('chat.title');

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`chat-launcher ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="chat-panel"
        aria-label={
          unreadCount > 0 ? t('chat.openWithUnread', { count: unreadCount }) : t('chat.open')
        }
      >
        <i className={`bi ${open ? 'bi-x-lg' : 'bi-chat-dots-fill'}`} aria-hidden="true" />
        {!open && unreadCount > 0 && (
          <span className="chat-launcher__badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="chat-panel"
          ref={panelRef}
          className="chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-panel-title"
          dir={i18n.dir()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) close();
          }}
        >
          {view === 'list' && (
            <ConversationList
              titleId="chat-panel-title"
              title={title}
              onClose={close}
              onOpen={openThread}
              onNew={() => setView('contacts')}
            />
          )}
          {view === 'contacts' && (
            <ContactPicker
              titleId="chat-panel-title"
              onBack={() => setView('list')}
              onClose={close}
              onOpen={openThread}
            />
          )}
          {view === 'thread' && conversationId && (
            <Thread
              key={conversationId}
              titleId="chat-panel-title"
              conversationId={conversationId}
              onBack={() => setView('list')}
              onClose={close}
            />
          )}
        </section>
      )}
    </>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function PanelHeader({ titleId, title, subtitle, avatar, onBack, onClose, children }) {
  const { t, i18n } = useTranslation();
  return (
    <header className="chat-head">
      {onBack && (
        <button type="button" className="chat-icon-btn" onClick={onBack} aria-label={t('common.back')}>
          <i
            className={`bi ${i18n.dir() === 'rtl' ? 'bi-arrow-right' : 'bi-arrow-left'}`}
            aria-hidden="true"
          />
        </button>
      )}
      {avatar}
      <div className="chat-head__text">
        <h2 id={titleId} className="chat-head__title">
          {title}
        </h2>
        {subtitle && <div className="chat-head__sub">{subtitle}</div>}
      </div>
      {children}
      <button type="button" className="chat-icon-btn" onClick={onClose} aria-label={t('chat.minimize')}>
        <i className="bi bi-dash-lg" aria-hidden="true" />
      </button>
    </header>
  );
}

function Avatar({ name, type, size = 36 }) {
  return (
    <span
      className={`chat-avatar ${type === 'INVESTIGATOR' ? 'is-field' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

// ── Conversation list ───────────────────────────────────────────────────────

function ConversationList({ titleId, title, onClose, onOpen, onNew }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useConversations(true);
  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const rows = (data ?? []).filter((row) =>
    (row.other?.name ?? '').toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const locale = i18n.language === 'en' ? 'en-GB' : 'ar-EG';

  return (
    <>
      <PanelHeader titleId={titleId} title={title} onClose={onClose}>
        <button type="button" className="chat-icon-btn is-accent" onClick={onNew} aria-label={t('chat.new')} title={t('chat.new')}>
          <i className="bi bi-pencil-square" aria-hidden="true" />
        </button>
      </PanelHeader>

      <div className="chat-search">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('chat.searchConversations')}
          aria-label={t('chat.searchConversations')}
        />
      </div>

      <div className="chat-scroll">
        {isLoading && <div className="chat-empty">{t('app.loading')}</div>}
        {!isLoading && rows.length === 0 && (
          <div className="chat-empty">
            <i className="bi bi-chat-square-heart" aria-hidden="true" />
            <p>{filter ? t('chat.noMatches') : t('chat.noConversations')}</p>
            {!filter && (
              <button type="button" className="btn btn-sm btn-primary" onClick={onNew}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                {t('chat.new')}
              </button>
            )}
          </div>
        )}
        <ul className="chat-list" aria-label={title}>
          {rows.map((row) => {
            const preview = row.last
              ? row.last.deleted
                ? t('chat.deleted')
                : row.last.body ||
                  (row.last.attachments.length
                    ? `📎 ${t('chat.files', { count: row.last.attachments.length })}`
                    : '')
              : t('chat.sayHello');
            const when = row.lastMessageAt ? new Date(row.lastMessageAt) : null;
            const sameDay = when && when.toDateString() === new Date().toDateString();
            const role = i18n.language === 'en' ? row.other?.roleEn : row.other?.roleAr;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={`chat-list__item ${row.unread ? 'is-unread' : ''}`}
                  onClick={() => onOpen(row.id)}
                  aria-label={`${row.other?.name ?? ''}${
                    row.unread ? ` — ${t('chat.unreadCount', { count: row.unread })}` : ''
                  }`}
                >
                  <Avatar name={row.other?.name} type={row.other?.type} size={42} />
                  <span className="chat-list__body">
                    <span className="chat-list__top">
                      <span className="chat-list__name">{row.other?.name ?? '—'}</span>
                      {when && (
                        <time className="chat-list__time" dateTime={row.lastMessageAt}>
                          {sameDay
                            ? when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
                            : when.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                        </time>
                      )}
                    </span>
                    <span className="chat-list__bottom">
                      <span className="chat-list__preview" dir="auto">
                        {row.last?.mine && !row.last.deleted && (
                          <span className="text-body-tertiary">{t('chat.you')}: </span>
                        )}
                        {preview}
                      </span>
                      {row.unread > 0 && (
                        <span className="chat-list__badge" aria-hidden="true">
                          {row.unread > 99 ? '99+' : row.unread}
                        </span>
                      )}
                    </span>
                    {role && <span className="visually-hidden">{role}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

// ── Contacts ────────────────────────────────────────────────────────────────

function ContactPicker({ titleId, onBack, onClose, onOpen }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useContacts(search, true);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const start = useMutation({
    mutationFn: async (contact) =>
      (await api.post('/chat/conversations', { type: contact.type, id: contact.id })).data,
    onSuccess: (result) => onOpen(result.id),
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const groups = [
    { key: 'WEB_USER', label: t('chat.office') },
    { key: 'INVESTIGATOR', label: t('chat.field') },
  ];

  return (
    <>
      <PanelHeader titleId={titleId} title={t('chat.new')} onBack={onBack} onClose={onClose} />
      <div className="chat-search">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('chat.searchPeople')}
          aria-label={t('chat.searchPeople')}
        />
      </div>
      <div className="chat-scroll">
        {isLoading && <div className="chat-empty">{t('app.loading')}</div>}
        {groups.map((group) => {
          const people = (data ?? []).filter((contact) => contact.type === group.key);
          if (people.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="chat-group-label" id={`chat-group-${group.key}`}>
                {group.label}
              </div>
              <ul className="chat-list" aria-labelledby={`chat-group-${group.key}`}>
                {people.map((contact) => (
                  <li key={contact.id}>
                    <button
                      type="button"
                      className="chat-list__item"
                      disabled={start.isPending}
                      onClick={() => start.mutate(contact)}
                    >
                      <Avatar name={contact.name} type={contact.type} size={38} />
                      <span className="chat-list__body">
                        <span className="chat-list__name">{contact.name}</span>
                        <span className="chat-list__preview">
                          {i18n.language === 'en' ? contact.roleEn : contact.roleAr}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!isLoading && (data ?? []).length === 0 && (
          <div className="chat-empty">{t('chat.noPeople')}</div>
        )}
      </div>
    </>
  );
}

// ── Thread ──────────────────────────────────────────────────────────────────

function Thread({ titleId, conversationId, onBack, onClose }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { messages, other, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useMessages(conversationId);
  const scrollRef = useRef(null);
  const atBottom = useRef(true);
  const lastId = messages[messages.length - 1]?.id;
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Keep the newest message in view unless the reader has scrolled up.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [lastId, isLoading]);

  // Reading: mark read when the thread opens and whenever something arrives
  // while the tab is visible.
  const lastIncoming = [...messages].reverse().find((message) => !message.mine)?.id;
  useEffect(() => {
    if (!lastIncoming || document.visibilityState !== 'visible') return;
    api
      .post(`/chat/conversations/${conversationId}/read`)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
        queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      })
      .catch(() => {});
  }, [lastIncoming, conversationId, queryClient]);

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/chat/messages/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const locale = i18n.language === 'en' ? 'en-GB' : 'ar-EG';
  const role = i18n.language === 'en' ? other?.roleEn : other?.roleAr;
  const seenAt = other?.lastReadAt ? new Date(other.lastReadAt) : null;
  const lastMine = [...messages].reverse().find((message) => message.mine && !message.deleted);

  let previousDay = null;

  return (
    <>
      <PanelHeader
        titleId={titleId}
        title={other?.name ?? t('app.loading')}
        subtitle={role}
        avatar={<Avatar name={other?.name} type={other?.type} size={36} />}
        onBack={onBack}
        onClose={onClose}
      />

      <div
        ref={scrollRef}
        className="chat-scroll chat-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.threadWith', { name: other?.name ?? '' })}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
      >
        {hasNextPage && (
          <div className="text-center my-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={isFetchingNextPage}
              onClick={() => {
                atBottom.current = false;
                fetchNextPage();
              }}
            >
              {t('chat.older')}
            </button>
          </div>
        )}
        {isLoading && <div className="chat-empty">{t('app.loading')}</div>}
        {!isLoading && messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty__wave" aria-hidden="true">👋</span>
            <p>{t('chat.sayHello')}</p>
          </div>
        )}

        {messages.map((message) => {
          const date = new Date(message.createdAt);
          const day = date.toDateString();
          const showDay = day !== previousDay;
          previousDay = day;
          const seen = message.mine && seenAt && seenAt >= date;
          return (
            <div key={message.id}>
              {showDay && (
                <div className="chat-day" role="separator">
                  <span>
                    {date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
              )}
              <div className={`chat-msg ${message.mine ? 'is-mine' : ''}`}>
                <div className={`chat-bubble ${message.deleted ? 'is-deleted' : ''}`}>
                  {message.deleted ? (
                    <span className="chat-bubble__deleted">
                      <i className="bi bi-slash-circle me-1" aria-hidden="true" />
                      {t('chat.deleted')}
                    </span>
                  ) : (
                    <>
                      {message.attachments.length > 0 && (
                        <div className="chat-files">
                          {message.attachments.map((attachment) => (
                            <ChatFile key={attachment.id} attachment={attachment} />
                          ))}
                        </div>
                      )}
                      {message.body && (
                        <div className="chat-bubble__text" dir="auto">
                          {message.body}
                        </div>
                      )}
                    </>
                  )}
                  <div className="chat-bubble__meta">
                    <time dateTime={message.createdAt}>
                      {date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
                    </time>
                    {message.mine && !message.deleted && (
                      <i
                        className={`bi ${seen ? 'bi-check2-all is-seen' : 'bi-check2'}`}
                        role="img"
                        aria-label={seen ? t('chat.seen') : t('chat.sent')}
                      />
                    )}
                  </div>
                </div>
                {message.mine && !message.deleted && (
                  <div className="chat-msg__actions">
                    {confirmDelete === message.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger py-0"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(message.id)}
                        >
                          {t('chat.confirmDelete')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-link py-0"
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t('common.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="chat-icon-btn is-small"
                        onClick={() => setConfirmDelete(message.id)}
                        aria-label={t('chat.delete')}
                        title={t('chat.delete')}
                      >
                        <i className="bi bi-trash3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {lastMine && seenAt && seenAt >= new Date(lastMine.createdAt) && (
          <div className="chat-seen-note">{t('chat.seenNote')}</div>
        )}
      </div>

      <Composer
        conversationId={conversationId}
        onSent={() => {
          atBottom.current = true;
        }}
      />
    </>
  );
}

// ── A file in a message ─────────────────────────────────────────────────────

function ChatFile({ attachment }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isImage = attachment.mimeType.startsWith('image/') && attachment.mimeType !== 'image/heic';
  const url = useChatFileUrl(attachment, isImage);

  const download = async () => {
    try {
      const blob = await fetchChatFile(attachment);
      if (blob.size === 0) throw new Error('empty');
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      toast.error(t('media.emptyDownload'));
    }
  };

  if (isImage) {
    return (
      <button type="button" className="chat-image" onClick={download} aria-label={`${t('chat.download')} ${attachment.fileName}`}>
        {url ? <img src={url} alt={attachment.fileName} /> : <span className="chat-image__loading" />}
      </button>
    );
  }

  const icon = attachment.mimeType.includes('pdf')
    ? 'bi-file-earmark-pdf'
    : attachment.mimeType.includes('sheet') || attachment.mimeType.includes('excel')
      ? 'bi-file-earmark-excel'
      : attachment.mimeType.includes('word')
        ? 'bi-file-earmark-word'
        : attachment.mimeType.startsWith('audio/')
          ? 'bi-file-earmark-music'
          : attachment.mimeType.startsWith('video/')
            ? 'bi-file-earmark-play'
            : 'bi-file-earmark';

  return (
    <button type="button" className="chat-file" onClick={download}>
      <i className={`bi ${icon}`} aria-hidden="true" />
      <span className="chat-file__text">
        <span className="chat-file__name" dir="auto">{attachment.fileName}</span>
        <span className="chat-file__size">{formatSize(attachment.size)}</span>
      </span>
      <i className="bi bi-download" aria-hidden="true" />
      <span className="visually-hidden">{t('chat.download')}</span>
    </button>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function Composer({ conversationId, onSent }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [picker, setPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const emojiButtonRef = useRef(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  // Grow with the text, up to about five lines.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [text]);

  const addFiles = (list) => {
    const incoming = [...(list ?? [])];
    const tooBig = incoming.filter((file) => file.size > MAX_FILE_BYTES);
    if (tooBig.length) toast.error(t('chat.tooBig', { name: tooBig[0].name }));
    const fitting = incoming.filter((file) => file.size <= MAX_FILE_BYTES);
    setFiles((current) => {
      const next = [...current, ...fitting].slice(0, MAX_FILES);
      if (current.length + fitting.length > MAX_FILES) toast.warning(t('chat.tooMany', { count: MAX_FILES }));
      return next;
    });
  };

  const send = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      if (text.trim()) body.append('body', text);
      for (const file of files) body.append('files', file);
      return (
        await api.post(`/chat/conversations/${conversationId}/messages`, body, {
          timeout: 180_000,
        })
      ).data;
    },
    onSuccess: () => {
      setText('');
      setFiles([]);
      onSent?.();
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      textRef.current?.focus();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const canSend = (text.trim() || files.length > 0) && text.length <= MAX_BODY && !send.isPending;

  const insertEmoji = (emoji) => {
    const element = textRef.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      element?.focus();
      const caret = start + emoji.length;
      element?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div
      className={`chat-composer ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer?.files);
      }}
    >
      {dragging && <div className="chat-drop">{t('chat.dropHere')}</div>}

      {files.length > 0 && (
        <ul className="chat-pending" aria-label={t('chat.attached')}>
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="chat-pending__item">
              <i className="bi bi-paperclip" aria-hidden="true" />
              <span className="chat-pending__name" dir="auto">{file.name}</span>
              <span className="chat-pending__size">{formatSize(file.size)}</span>
              <button
                type="button"
                className="chat-icon-btn is-small"
                onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                aria-label={t('chat.removeFile', { name: file.name })}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picker && (
        <EmojiPicker
          onPick={insertEmoji}
          onClose={() => {
            setPicker(false);
            emojiButtonRef.current?.focus();
          }}
        />
      )}

      <div className="chat-composer__row">
        <button
          ref={emojiButtonRef}
          type="button"
          className={`chat-icon-btn ${picker ? 'is-active' : ''}`}
          onClick={() => setPicker((current) => !current)}
          aria-label={t('chat.emoji.title')}
          aria-expanded={picker}
          title={t('chat.emoji.title')}
        >
          <i className="bi bi-emoji-smile" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-icon-btn"
          onClick={() => fileRef.current?.click()}
          aria-label={t('chat.attach')}
          title={t('chat.attach')}
        >
          <i className="bi bi-paperclip" aria-hidden="true" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="d-none"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <label className="visually-hidden" htmlFor={`chat-input-${conversationId}`}>
          {t('chat.placeholder')}
        </label>
        <textarea
          id={`chat-input-${conversationId}`}
          ref={textRef}
          className="chat-input"
          rows={1}
          dir="auto"
          value={text}
          placeholder={t('chat.placeholder')}
          maxLength={MAX_BODY + 100}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            if (event.clipboardData?.files?.length) {
              event.preventDefault();
              addFiles(event.clipboardData.files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) send.mutate();
            }
          }}
        />
        <button
          type="button"
          className="chat-send"
          disabled={!canSend}
          onClick={() => send.mutate()}
          aria-label={t('chat.send')}
          title={t('chat.send')}
        >
          {send.isPending ? (
            <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          ) : (
            <i className="bi bi-send-fill" aria-hidden="true" />
          )}
        </button>
      </div>
      {text.length > MAX_BODY - 300 && (
        <div className={`chat-counter ${text.length > MAX_BODY ? 'text-danger' : ''}`} aria-live="polite">
          {text.length} / {MAX_BODY}
        </div>
      )}
      <div className="chat-hint">{t('chat.hint')}</div>
    </div>
  );
}

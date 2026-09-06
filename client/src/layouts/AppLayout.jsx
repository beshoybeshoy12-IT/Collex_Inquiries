import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../app/AuthContext';
import { setLanguage, LANGUAGES, localisedName } from '../i18n';
import { visibleNavigation } from './navigation';
import api from '../services/api';
import { P } from '../utils/permissions';
import Dropdown from '../components/Dropdown';
import NotificationBell from '../modules/notifications/NotificationBell';
import Logo from '../components/Logo';

/**
 * Whether a navigation entry describes the page currently on screen.
 *
 * NavLink's own `isActive` compares PATHNAMES ONLY. Every entry under
 * Operations is the same pathname with a different query —
 * `/investigations`, `/investigations?statusGroup=NEW`,
 * `/investigations?overdue=true` — so on the case list all nine matched at
 * once and the whole section rendered solid blue.
 *
 * So the query is part of the comparison: an entry is active when the path
 * matches AND every parameter it names has that value. "All cases", which
 * names no parameters, is active only when no sibling's parameter is set —
 * otherwise it would light up alongside whichever filter is applied.
 */
function isNavItemActive(to, location, { end = false, siblings = [] } = {}) {
  const [path, query = ''] = to.split('?');
  const target = new URLSearchParams(query);
  const current = new URLSearchParams(location.search);

  const pathMatches = end
    ? location.pathname === path
    : location.pathname === path || location.pathname.startsWith(`${path}/`);
  if (!pathMatches) return false;

  for (const [key, value] of target) {
    if (current.get(key) !== value) return false;
  }

  // An entry with no parameters of its own is the unfiltered view.
  if ([...target].length === 0) {
    const owned = new Set();
    for (const sibling of siblings) {
      const [, siblingQuery = ''] = sibling.split('?');
      for (const [key] of new URLSearchParams(siblingQuery)) owned.add(key);
    }
    for (const key of owned) if (current.has(key)) return false;
  }

  return true;
}

/**
 * The application shell.
 *
 * NAVIGATION IS FILTERED BY PERMISSION, not merely disabled. A user who cannot
 * reach a screen does not see a link to it — a greyed-out menu full of things
 * somebody cannot do is a worse experience than a short menu of things they
 * can.
 *
 * The counters beside the operations links come from one call to
 * `/investigations/counts` rather than one per link, and they refresh on a
 * slow interval: they are context, not a live feed, and polling them hard
 * would put a query per user per second on the case table.
 */
export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, signOut, can } = useAuth();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openSections, setOpenSections] = useState(() => new Set(['operations']));

  // Close the mobile drawer on navigation, or it stays over the page the user
  // just asked for.
  useEffect(() => setSidebarOpen(false), [location.pathname, location.search]);

  const navigation = visibleNavigation(can, {
    isSuperAdmin: Boolean(user?.isSuperAdmin),
  });

  const { data: counts } = useQuery({
    queryKey: ['investigation-counts'],
    queryFn: async () => (await api.get('/investigations/counts')).data,
    enabled: can(P.INVESTIGATIONS_VIEW),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const countFor = (key) => {
    if (!counts || !key) return null;
    if (key === 'overdue') return counts.overdue || null;
    return counts.byGroup?.[key] || null;
  };

  const toggleSection = (key) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <div className="d-flex min-vh-100 bg-body-tertiary">
      {/* Backdrop for the mobile drawer */}
      {sidebarOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-lg-none"
          style={{ background: 'rgba(0,0,0,.4)', zIndex: 1040 }}
          onClick={() => setSidebarOpen(false)}
          role="presentation"
        />
      )}

      <aside
        className={`bg-body border-end d-flex flex-column ${
          sidebarOpen ? 'position-fixed h-100' : 'd-none d-lg-flex'
        }`}
        style={{ width: 260, zIndex: 1045, insetInlineStart: 0, insetBlockStart: 0 }}
      >
        <div className="p-3 border-bottom">
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 text-bg-primary"
              style={{ width: 34, height: 34 }}
              aria-hidden="true"
            >
              <Logo size={22} />
            </span>
            <div className="lh-sm">
              <div className="fw-semibold">{t('app.name')}</div>
              <div className="text-body-secondary" style={{ fontSize: '.72rem' }}>
                {user?.tenant ? localisedName(user.tenant) : t('app.tagline')}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-grow-1 overflow-auto p-2" aria-label="main">
          <ul className="nav nav-pills sidebar-nav flex-column gap-1">
            {navigation.map((item) =>
              item.children ? (
                <li key={item.key}>
                  {/* A collapsed section still marks itself when the page on
                      screen is one of its children — otherwise closing a
                      section loses the only clue about where you are. */}
                  <button
                    type="button"
                    className={`nav-link nav-section d-flex align-items-center w-100 text-start ${
                      !openSections.has(item.key) &&
                      item.children.some((child) =>
                        isNavItemActive(child.to, location, {
                          end: child.end,
                          siblings: item.children.map((c) => c.to),
                        }),
                      )
                        ? 'active'
                        : 'text-body'
                    }`}
                    onClick={() => toggleSection(item.key)}
                    aria-expanded={openSections.has(item.key)}
                  >
                    <i className={`bi bi-${item.icon} me-2`} aria-hidden="true" />
                    <span className="flex-grow-1">{t(item.labelKey)}</span>
                    <i
                      className={`bi bi-chevron-${
                        openSections.has(item.key) ? 'up' : 'down'
                      } small`}
                      aria-hidden="true"
                    />
                  </button>

                  {openSections.has(item.key) && (
                    <ul className="nav flex-column ms-3 mt-1 gap-1 border-start ps-2">
                      {item.children.map((child) => {
                        const count = countFor(child.countKey);
                        // Not NavLink's isActive — see isNavItemActive above.
                        const active = isNavItemActive(child.to, location, {
                          end: child.end,
                          siblings: item.children.map((c) => c.to),
                        });
                        return (
                          <li key={child.key}>
                            <NavLink
                              to={child.to}
                              end={child.end}
                              aria-current={active ? 'page' : undefined}
                              // The FUNCTION form, deliberately, and its
                              // `isActive` is ignored. Given a plain string,
                              // NavLink appends its own `active` class — which
                              // is pathname-only and would light up all nine
                              // siblings again, on top of whatever this decides.
                              className={() =>
                                `nav-link nav-sub py-1 px-2 small d-flex align-items-center ${
                                  active ? 'active' : 'text-body-secondary'
                                }`
                              }
                            >
                              <span className="flex-grow-1">{t(child.labelKey)}</span>
                              {count != null && (
                                <span
                                  className={`badge rounded-pill text-bg-${
                                    child.tone ?? 'secondary'
                                  }`}
                                >
                                  {count}
                                </span>
                              )}
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ) : (
                <li key={item.key}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `nav-link d-flex align-items-center ${
                        isActive ? 'active' : 'text-body'
                      }`
                    }
                  >
                    <i className={`bi bi-${item.icon} me-2`} aria-hidden="true" />
                    {t(item.labelKey)}
                  </NavLink>
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className="p-2 border-top small text-body-secondary">
          <div className="px-2 py-1 text-truncate" title={user?.fullName}>
            {user?.fullName}
          </div>
          <div className="px-2 text-truncate" style={{ fontSize: '.72rem' }}>
            {user?.role ? localisedName(user.role) : ''}
          </div>
        </div>
      </aside>

      <div className="flex-grow-1 d-flex flex-column min-vw-0">
        <header className="bg-body border-bottom sticky-top">
          <div className="d-flex align-items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary d-lg-none"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="menu"
            >
              <i className="bi bi-list" aria-hidden="true" />
            </button>

            <div className="flex-grow-1" />

            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setLanguage(otherLanguage)}
              title={t('app.language')}
            >
              {LANGUAGES[otherLanguage].name}
            </button>

            <NotificationBell />

            <Dropdown
              icon="person-circle"
              label={
                <span className="d-none d-sm-inline">
                  {user?.fullName?.split(' ')[0]}
                </span>
              }
            >
              <li>
                <NavLink className="dropdown-item" to="/profile">
                  <i className="bi bi-person me-2" aria-hidden="true" />
                  {t('auth.profile')}
                </NavLink>
              </li>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <button className="dropdown-item text-danger" onClick={signOut}>
                  <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />
                  {t('auth.signOut')}
                </button>
              </li>
            </Dropdown>
          </div>
        </header>

        <main className="flex-grow-1 p-3 p-lg-4 min-vw-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

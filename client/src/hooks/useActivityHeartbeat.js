import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api, { tokenStore } from '../services/api';

const BEAT_MS = 60_000;

/**
 * Tells the server "this person is using the system" — the input to the
 * attendance idle rule.
 *
 * Mounted once, in the app layout, so it runs on every screen: a person
 * working in the case list must not be counted idle because the home page is
 * not open.
 *
 * A beat is sent at most once a minute and ONLY if there was real input
 * (mouse, keys, touch, scroll) since the last one, and only while the tab is
 * visible. Merely having the page open is not activity. The server ignores a
 * beat from somebody who is not checked in.
 */
export function useActivityHeartbeat() {
  const queryClient = useQueryClient();
  const lastInput = useRef(Date.now());

  useEffect(() => {
    const mark = () => {
      lastInput.current = Date.now();
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((name) => window.addEventListener(name, mark, { passive: true }));

    const timer = setInterval(async () => {
      if (!tokenStore.access) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInput.current > BEAT_MS) return;

      try {
        const { data } = await api.post('/attendance/me/heartbeat');
        // Coming back from an idle stretch changes today's totals.
        if (data?.resumedFromIdle) {
          queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
        }
      } catch {
        // A missed beat is at worst a little idle time; never an error dialog.
      }
    }, BEAT_MS);

    return () => {
      events.forEach((name) => window.removeEventListener(name, mark));
      clearInterval(timer);
    };
  }, [queryClient]);
}

// =============================================================================
// OutNYC: live "today" hook (lib/useTodayNY.ts)
// =============================================================================
// Every screen that highlights today, hides past days, or labels a date as
// upcoming must react to the NY day actually changing. Three triggers, because
// no single one covers every way this app is used:
//   - AppState 'active'      : the phone was unlocked / the app foregrounded
//   - screen focus           : the user navigated back to this tab
//   - a midnight timer       : the app stayed visible across midnight, so
//                              neither of the above ever fires (a home-screen
//                              PWA left open, or a desktop tab)
// The timer re-arms itself off the true NY midnight instant, so the 23-hour
// and 25-hour DST days roll over on the real boundary.
// =============================================================================

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { msUntilNextNYMidnight, todayNY } from './time';

/** The current America/New_York date, kept fresh while the screen lives. */
export function useTodayNY(): string {
  const [today, setToday] = useState(() => todayNY());

  useEffect(() => {
    const refresh = () => setToday(todayNY());

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    // setTimeout, not setInterval: each tick re-arms from the next true NY
    // midnight, so drift and DST-length days can never desynchronize it.
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextNYMidnight());
    };
    arm();

    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      setToday(todayNY());
    }, []),
  );

  return today;
}

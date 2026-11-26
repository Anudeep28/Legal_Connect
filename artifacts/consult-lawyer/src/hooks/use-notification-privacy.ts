import { useEffect, useState } from 'react';

const STORAGE_KEY = 'consult-lawyer:hide-notification-previews:v1';
const CHANGE_EVENT = 'consult-lawyer:notification-privacy-change';

function readPreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useNotificationPrivacy() {
  const [hidePreviews, setHidePreviews] = useState(readPreference);

  useEffect(() => {
    const sync = () => setHidePreviews(readPreference());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const updateHidePreviews = (next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Keep the preference active for this page even if browser storage is unavailable.
    }
    setHidePreviews(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return [hidePreviews, updateHidePreviews] as const;
}

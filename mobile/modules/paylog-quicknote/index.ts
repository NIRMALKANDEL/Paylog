// The Android home-screen quick note (native, see android/). On iOS and the web
// the module doesn't exist and these calls do nothing.
import { requireOptionalNativeModule } from 'expo';

type Native = {
  setSession(apiUrl: string, token: string | null): void;
  takeLastSaved(): string | null;
  pendingCount(): number;
};

const native = requireOptionalNativeModule<Native>('PaylogQuickNote');

/** Share the sign-in with the quick note so it can save while the app is closed. */
export function setQuickNoteSession(apiUrl: string, token: string | null) {
  try {
    native?.setSession(apiUrl, token);
  } catch {
    /* never block sign-in on this */
  }
}

/** The last entry saved from the quick note ("Saved ₹250 · Food"), returned once. */
export function takeQuickNoteSaved(): string | null {
  try {
    return native?.takeLastSaved() ?? null;
  } catch {
    return null;
  }
}

/** Notes typed offline that are still waiting to be sent. */
export function pendingQuickNotes(): number {
  try {
    return native?.pendingCount() ?? 0;
  } catch {
    return 0;
  }
}

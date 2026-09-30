// A payment screenshot or bank SMS shared to Paylog (Share → Paylog) opens the scanner.
import { getShareExtensionKey } from 'expo-share-intent';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/scan?shared=1';
    return path;
  } catch {
    return '/';
  }
}

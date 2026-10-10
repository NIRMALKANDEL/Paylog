// Reading payment screenshots and receipts on the phone (Google ML Kit / Apple Vision),
// and shrinking images for the online reader when the phone can't read one.
import { requireOptionalNativeModule } from 'expo';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage, isSupported } from 'expo-text-extractor';

export type OcrLine = { text: string; height?: number };
type NativeLine = { text: string; top: number; left: number; height: number };

// Added by patches/expo-text-extractor (Android): lines with their position and size.
const native = requireOptionalNativeModule<{ extractLinesFromImage?: (uri: string) => Promise<NativeLine[]> }>(
  'ExpoTextExtractor',
);

export const canReadOnDevice = isSupported;

/** expo-text-extractor takes a content:// URI or a plain file path (not file://...). */
function nativePath(uri: string) {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

/**
 * Put pieces of text that sit on the same row back together, top to bottom:
 * "ads" and "₹500" at the same height become "ads ₹500", as they look on screen.
 */
export function toRows(lines: NativeLine[]): OcrLine[] {
  const sorted = lines.filter((l) => l.text.trim()).sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: NativeLine[][] = [];
  for (const line of sorted) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    const middle = line.top + line.height / 2;
    if (first && Math.abs(first.top + first.height / 2 - middle) < Math.min(first.height, line.height) * 0.5) {
      row.push(line);
    } else {
      rows.push([line]);
    }
  }
  return rows.map((row) => {
    const parts = [...row].sort((a, b) => a.left - b.left);
    return { text: parts.map((p) => p.text.trim()).join(' '), height: Math.max(...parts.map((p) => p.height)) };
  });
}

/** Every line of text in the image, top to bottom, with its size when the phone reports it. */
export async function readImageLines(uri: string): Promise<OcrLine[]> {
  if (!isSupported) throw new Error("This phone can't read text from images.");
  const path = nativePath(uri);
  if (native?.extractLinesFromImage) return toRows(await native.extractLinesFromImage(path));
  const blocks = await extractTextFromImage(path);
  return blocks.flatMap((b) => b.split('\n')).filter((t) => t.trim()).map((text) => ({ text }));
}

/** A JPEG under the online reader's 1 MB limit: at most 1600 px tall, recompressed. */
export async function shrinkForUpload(uri: string) {
  let result = await manipulateAsync(uri, [], { compress: 0.8, format: SaveFormat.JPEG });
  // Never enlarge a small screenshot; only shrink tall ones.
  for (const [height, compress] of [[1600, 0.7], [1300, 0.55], [1000, 0.45]] as const) {
    const size = (await fetch(result.uri).then((r) => r.blob())).size;
    if (size < 950 * 1024) break;
    result = await manipulateAsync(uri, result.height > height ? [{ resize: { height } }] : [],
      { compress, format: SaveFormat.JPEG });
  }
  return result.uri;
}

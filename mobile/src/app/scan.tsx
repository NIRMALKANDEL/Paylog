import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useShareIntentContext } from 'expo-share-intent';
import { extractTextFromImage, isSupported } from 'expo-text-extractor';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { Body, Button, Card, Field, H2, Muted, Notice, Row, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import type { Transaction } from '@/lib/types';
import { refreshWidgets } from '@/lib/widget';

type ParseResult = {
  form: { kind: string; amount: string; category: string; date: string; description: string; reference: string };
  found: string[];
  app: string | null;
  clear: boolean;
  duplicate: { date: string } | null;
  saved: Transaction | null;
};

export default function Scan() {
  const user = useUser();
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Transaction | null>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  // Shared from GPay / PhonePe / Messages (Share → Paylog): read it straight away.
  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent.files?.find((f) => (f.mimeType || '').startsWith('image/'));
    const text = shareIntent.text || '';
    resetShareIntent();
    if (file) run(() => readImage(file.path));
    else if (text.trim()) run(() => handleText(text));
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  async function readImage(uri: string) {
    setImage(uri);
    setStatus('Reading the screenshot on your phone…');
    if (!isSupported) throw new Error('Text reading is not available on this device. Paste the text below instead.');
    const lines = await extractTextFromImage(uri);
    const text = lines.join('\n').trim();
    if (!text) throw new Error("We couldn't find any text in that image. Try a sharper screenshot, or paste the text.");
    await handleText(text);
  }

  async function handleText(text: string) {
    setStatus('Reading the details…');
    const result = await api<ParseResult>('/receipts/parse', { body: { text } });
    if (result.saved) {
      setSaved(result.saved);
      refreshWidgets(user.currency);
      return;
    }
    // Not clear enough (or a duplicate): review it in the normal form.
    router.push({ pathname: '/transaction/new', params: { ...result.form } });
  }

  async function pick(source: 'camera' | 'library') {
    setError(null);
    setSaved(null);
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Camera permission is off. You can allow it in your phone settings, or pick a screenshot instead.');
        return;
      }
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.length) return;
    await run(() => readImage(res.assets[0].uri));
  }

  function submitPasted() {
    run(async () => {
      await handleText(pasted);
      setPasted('');
    });
  }

  async function undo() {
    if (!saved) return;
    try {
      await api(`/transactions/${saved.id}`, { method: 'DELETE' });
      setSaved(null);
      refreshWidgets(user.currency);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Screen>
      <Body>Pick a payment screenshot from Google Pay, PhonePe, Paytm or BHIM, photograph a bill, or use Share → Paylog in those apps. Paylog reads it on your phone and fills in the amount, date and payee.</Body>

      {saved ? (
        <Card>
          <Notice tone="good">
            {`Saved ${formatMoney(saved.amount_cents, user.currency)} · ${saved.description || saved.category} · ${saved.category}`}
          </Notice>
          <Row>
            <Button title="Undo" variant="ghost" small onPress={undo} />
            <Button title="Edit" variant="ghost" small onPress={() =>
              router.push({ pathname: '/transaction/[id]', params: { id: String(saved.id) } })} />
            <View style={{ flex: 1 }} />
            <Button title="Done" small onPress={() => router.back()} />
          </Row>
        </Card>
      ) : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {status ? <Notice tone="info">{status}</Notice> : null}

      <Row>
        <Button title="Screenshot" icon="image" onPress={() => pick('library')} loading={busy} style={{ flex: 1 }} />
        <Button title="Camera" icon="camera" variant="soft" onPress={() => pick('camera')} disabled={busy} style={{ flex: 1 }} />
      </Row>

      {image ? (
        <Image source={{ uri: image }} style={{ width: '100%', height: 260, borderRadius: 14 }} resizeMode="contain"
          accessibilityLabel="The receipt you picked" />
      ) : null}

      <Card>
        <H2>Or paste the text</H2>
        <Muted>A bank SMS or the text of a payment works too.</Muted>
        <Field value={pasted} onChangeText={setPasted} multiline placeholder="Rs.250.00 debited from A/c XX1234 to SWIGGY on 12-09-26…"
          style={{ minHeight: 90, textAlignVertical: 'top' }} />
        <Button title="Read text" variant="soft" onPress={submitPasted} disabled={!pasted.trim() || busy} />
      </Card>
      <Muted>Clearly read payments are saved straight away (with Undo). You can turn this off in Settings → Receipts.</Muted>
    </Screen>
  );
}

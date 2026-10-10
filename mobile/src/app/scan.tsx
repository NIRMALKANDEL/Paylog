import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { Body, Button, Card, Field, H2, Label, Muted, Notice, Row, Screen } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { friendlyDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { canReadOnDevice, readImageLines, shrinkForUpload, type OcrLine } from '@/lib/ocr';
import { rememberCategory } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import type { Kind, Transaction } from '@/lib/types';
import { useData } from '@/lib/useData';
import { refreshWidgets } from '@/lib/widget';

type Form = {
  kind: Kind; amount: string; category: string; date: string; description: string; reference: string;
  time: string; method: string;
};
type Match = { date: string; amount_cents: number; description: string; category: string };
type ParseResult = { form: Form; warnings: string[]; app: string | null; duplicate: Match | null; similar: Match | null };

type State =
  | { step: 'idle' }
  | { step: 'reading'; image: string | null; message: string }
  | { step: 'review'; image: string | null; result: ParseResult; online: boolean }
  | { step: 'failed'; image: string | null; message: string; partial: Form | null; triedOnline: boolean };

const cents = (amount: string) => Math.round(parseFloat(amount.replace(/,/g, '')) * 100) || 0;

export default function Scan() {
  const user = useUser();
  const { colors } = useTheme();
  const toast = useToast();
  const [state, setState] = useState<State>({ step: 'idle' });
  const [pasted, setPasted] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const meta = useData<{ online_reader?: boolean }>('/meta');
  const onlineReader = !!meta.data?.online_reader;
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();

  // Shared from GPay / PhonePe / Messages (Share → Paylog): read it straight away.
  useEffect(() => {
    if (!hasShareIntent) return;
    // Prefer an image, but try any shared file: some apps don't report a MIME type.
    const files = shareIntent.files || [];
    const file = files.find((f) => (f.mimeType || '').startsWith('image/')) || files[0];
    const text = shareIntent.text || '';
    resetShareIntent();
    if (file) readImage(file.path, shareError);
    else if (text.trim()) readText(text);
    else fail(null, "Nothing we can read was shared. Share a screenshot of the payment, or its text.", null);
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  function fail(image: string | null, message: string, partial: Form | null, triedOnline = false) {
    setState({ step: 'failed', image, message, partial, triedOnline });
  }

  async function parse(image: string | null, body: { lines?: OcrLine[]; text?: string }) {
    setState({ step: 'reading', image, message: 'Finding the amount, date and payee…' });
    try {
      const result = await api<ParseResult>('/receipts/parse', { body });
      showResult(image, result, false);
    } catch (err) {
      fail(image, errorMessage(err), null);
    }
  }

  function showResult(image: string | null, result: ParseResult, online: boolean) {
    setSaveError(null);
    if (!result.form.amount) {
      fail(image, online
        ? "The online reader couldn't find the amount either."
        : "We couldn't read the amount in this image.", result.form, online);
    } else {
      setState({ step: 'review', image, result, online });
    }
  }

  async function readImage(uri: string, shareProblem?: string | null) {
    setState({ step: 'reading', image: uri, message: 'Reading the image on your phone…' });
    if (!canReadOnDevice) {
      fail(uri, "This phone can't read text from images.", null);
      return;
    }
    let lines: OcrLine[];
    try {
      lines = await readImageLines(uri);
    } catch (err) {
      // The technical reason goes to the log, not the screen.
      console.warn('Reading image failed', shareProblem, errorMessage(err));
      fail(uri, "We couldn't open that image. Try picking it with the Screenshot button instead.", null);
      return;
    }
    if (!lines.length) {
      fail(uri, "We couldn't find any text in that image.", null);
      return;
    }
    await parse(uri, { lines });
  }

  function readText(text: string) {
    return parse(null, { text });
  }

  async function readOnline(image: string) {
    setState({ step: 'reading', image, message: 'Sending the image to the online reader…' });
    try {
      const small = await shrinkForUpload(image);
      const form = new FormData();
      form.append('image', { uri: small, name: 'receipt.jpg', type: 'image/jpeg' } as unknown as Blob);
      const result = await api<ParseResult>('/receipts/parse', { form });
      showResult(image, result, true);
    } catch (err) {
      fail(image, errorMessage(err), null, true);
    }
  }

  async function pick(source: 'camera' | 'library') {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        fail(null, 'Camera permission is off. You can allow it in your phone settings, or pick a screenshot instead.', null);
        return;
      }
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.length) return;
    await readImage(res.assets[0].uri);
  }

  function edit(form: Form | null, warnings: string[] = []) {
    const params: Record<string, string> = {};
    if (form) {
      for (const [k, v] of Object.entries(form)) if (v) params[k] = String(v);
    }
    if (warnings.length) params.unsure = warnings.join(',');
    router.push({ pathname: '/transaction/new', params });
  }

  async function save(result: ParseResult, allowDuplicate = false) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { transaction: tx } = await api<{ transaction: Transaction }>('/transactions',
        { body: { ...result.form, allow_duplicate: allowDuplicate } });
      rememberCategory(tx.kind, tx.category);
      refreshWidgets(user.currency);
      toast({
        text: `Saved ${tx.kind === 'income' ? '+' : '−'}${formatMoney(tx.amount_cents, user.currency)} · ${tx.description || tx.category}`,
        action: {
          label: 'Undo',
          onPress: () => {
            api(`/transactions/${tx.id}`, { method: 'DELETE' })
              .then(() => { refreshWidgets(user.currency); toast({ text: 'Removed.', tone: 'info' }); })
              .catch((err) => toast({ text: errorMessage(err), tone: 'info' }));
          },
        },
      });
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      setSaveError(err instanceof ApiError && err.status === 409
        ? 'This payment is already saved (same UPI reference).'
        : errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Screen>
      {state.step === 'idle' ? (
        <>
          <Card>
            <Row>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: colors.accentSoft }}>
                <Icon name="scan" size={24} color={colors.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <H2>Scan a payment</H2>
                <Muted>GPay, PhonePe, Paytm, BHIM screenshots or a shop bill</Muted>
              </View>
            </Row>
            <Body>Paylog reads the amount, + / −, who it was with, the date and the UPI reference. You check it, then save.</Body>
            <Row>
              <Button title="Screenshot" icon="image" onPress={() => pick('library')} style={{ flex: 1 }} />
              <Button title="Camera" icon="camera" variant="soft" onPress={() => pick('camera')} style={{ flex: 1 }} />
            </Row>
            <Muted>Tip: in a payment app, tap Share → Paylog to scan without opening Paylog first.</Muted>
          </Card>

          <Card>
            <H2>Or paste the text</H2>
            <Muted>A bank SMS or a payment message works too.</Muted>
            <Field value={pasted} onChangeText={setPasted} multiline placeholder="Rs.250.00 debited from A/c XX1234 to SWIGGY on 12-09-26…"
              style={{ minHeight: 90, textAlignVertical: 'top' }} />
            <Button title="Read text" variant="soft" onPress={() => readText(pasted)} disabled={!pasted.trim()} />
          </Card>
          <Muted style={{ textAlign: 'center' }}>Images are read on your phone. Nothing is saved until you tap Save.</Muted>
        </>
      ) : null}

      {state.step === 'reading' ? (
        <Card style={{ alignItems: 'center' }}>
          {state.image ? <ScanningImage uri={state.image} /> : null}
          <Notice tone="info">{state.message}</Notice>
        </Card>
      ) : null}

      {state.step === 'review' ? (
        <Review
          image={state.image}
          result={state.result}
          online={state.online}
          currency={user.currency}
          saving={saving}
          error={saveError}
          onSave={(allowDuplicate) => save(state.result, allowDuplicate)}
          onEdit={() => edit(state.result.form, state.result.warnings)}
          onRestart={() => setState({ step: 'idle' })}
        />
      ) : null}

      {state.step === 'failed' ? (
        <Animated.View entering={FadeIn.duration(200)} style={{ gap: 14 }}>
          <Card>
            <Row style={{ alignItems: 'flex-start' }}>
              <Icon name="alert" size={22} color={colors.warning} />
              <View style={{ flex: 1, gap: 4 }}>
                <H2>Couldn&apos;t read it</H2>
                <Body>{state.message}</Body>
              </View>
            </Row>
            {state.image ? (
              <Image source={{ uri: state.image }} style={{ width: '100%', height: 200, borderRadius: 14 }} resizeMode="contain"
                accessibilityLabel="The image you picked" />
            ) : null}
            {state.image && onlineReader && !state.triedOnline ? (
              <>
                <Button title="Try the online reader" icon="upload" onPress={() => readOnline(state.image as string)} />
                <Muted>Sends this image to a text-reading service (OCR.space) once, to read it. It isn&apos;t stored there.</Muted>
              </>
            ) : null}
            <Button title="Enter it yourself" icon="edit" variant={state.image && onlineReader && !state.triedOnline ? 'soft' : 'primary'}
              onPress={() => edit(state.partial)} />
            <Button title="Try another image" variant="ghost" onPress={() => setState({ step: 'idle' })} />
          </Card>
          {state.partial && (state.partial.description || state.partial.reference) ? (
            <Muted>What we could read (date, payee, reference) is already filled in when you enter it yourself.</Muted>
          ) : null}
        </Animated.View>
      ) : null}
    </Screen>
  );
}

/** The picked image with a light sweeping across it while it's being read. */
function ScanningImage({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!reduced) y.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, y]);
  const sweep = useAnimatedStyle(() => ({ top: `${y.value * 92}%` }));
  return (
    <View style={{ width: '100%', height: 280, borderRadius: 16, overflow: 'hidden' }}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel="The image being read" />
      {reduced ? null : (
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, height: 22,
          backgroundColor: colors.accent, opacity: 0.35, borderRadius: 11,
          shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 16, elevation: 6 }, sweep]} />
      )}
    </View>
  );
}

function Review({ image, result, online, currency, saving, error, onSave, onEdit, onRestart }: {
  image: string | null; result: ParseResult; online: boolean; currency: string; saving: boolean; error: string | null;
  onSave: (allowDuplicate: boolean) => void; onEdit: () => void; onRestart: () => void;
}) {
  const { colors } = useTheme();
  const f = result.form;
  const income = f.kind === 'income';
  const unsureAmount = result.warnings.includes('amount');
  const unsureDirection = result.warnings.includes('direction');
  const match = result.duplicate || result.similar;

  const rows: [string, string][] = [
    [income ? 'From' : 'To', f.description || '—'],
    ['Date', `${friendlyDate(f.date)}${f.time ? `, ${f.time}` : ''}`],
    ['Category', f.category],
  ];
  if (f.method) rows.push(['Paid with', f.method]);
  if (f.reference) rows.push(['UPI reference', f.reference]);

  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ gap: 14 }}>
      <Card strong style={{ alignItems: 'center', gap: 6, paddingVertical: 22 }}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
          backgroundColor: income ? colors.goodBg : colors.dangerBg }}>
          <Text style={{ fontWeight: '800', color: income ? colors.credit : colors.debit }}>
            {income ? '+ Credit · money received' : '− Debit · money paid'}
          </Text>
        </View>
        <Text accessibilityLabel={`${income ? 'Received' : 'Paid'} ${formatMoney(cents(f.amount), currency)}`}
          style={{ fontSize: 44, fontWeight: '800', letterSpacing: -1, color: income ? colors.credit : colors.ink,
            fontVariant: ['tabular-nums'] }}>
          {income ? '+' : '−'}{formatMoney(cents(f.amount), currency)}
        </Text>
        <Muted>{online ? 'Read by the online reader' : 'Read on your phone'}{result.app ? ` · ${result.app}` : ''}</Muted>
      </Card>

      {unsureAmount || unsureDirection ? (
        <Notice tone="warning">
          {unsureAmount && unsureDirection
            ? 'Please check the amount and whether money was paid or received: the image wasn’t fully clear.'
            : unsureAmount
              ? 'Please check the amount against the image: it wasn’t fully clear.'
              : 'Please check: was this money paid (−) or received (+)? The image doesn’t say clearly.'}
        </Notice>
      ) : null}
      {match ? (
        <Notice tone="warning">
          {`${result.duplicate ? 'Already saved' : 'Looks like one you saved'} on ${friendlyDate(match.date)}: ${formatMoney(match.amount_cents, currency)} · ${match.description || match.category}.`}
        </Notice>
      ) : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}

      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {rows.map(([label, value], i) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11,
            borderTopWidth: i ? 1 : 0, borderTopColor: colors.glassEdge }}>
            <Label>{label}</Label>
            <Text selectable style={{ color: colors.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
          </View>
        ))}
      </Card>

      {image ? (
        <Image source={{ uri: image }} style={{ width: '100%', height: 220, borderRadius: 16 }} resizeMode="contain"
          accessibilityLabel="The scanned image" />
      ) : null}

      <Row>
        <Button title="Edit" icon="edit" variant="soft" onPress={onEdit} style={{ flex: 1 }} />
        <Button title={result.duplicate ? 'Save anyway' : 'Save'} icon="check" loading={saving}
          onPress={() => onSave(!!result.duplicate)} style={{ flex: 1.4 }} />
      </Row>
      <Button title="Scan another" variant="ghost" small onPress={onRestart} />
    </Animated.View>
  );
}

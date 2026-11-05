import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { cleanPlaceLabel, formatCoords, type Location, mapUrl, MAX_PLACE_LABEL, parseLocation } from '../lib/locationCore';
import { useT } from '../i18n';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

/**
 * Enviar localização em texto curto (design: "Localização · Texto curto · chega até por LoRa"). O
 * app não lê o GPS: a pessoa digita as coordenadas ou cola um link de mapa, e pode dar um nome ao
 * lugar. Só envia com uma coordenada válida.
 */
export function LocationSheet({ onSend, onClose }: { onSend: (loc: Location, label: string) => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sheet = useRef<SheetHandle>(null);
  const [raw, setRaw] = useState('');
  const [label, setLabel] = useState('');
  const loc = parseLocation(raw);
  const input = { borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, color: c.ink } as const;
  const paste = () => { void Clipboard.getStringAsync().then(t => { if (t) setRaw(t.slice(0, 2000)); }).catch(() => {}); };
  return (
    <Sheet ref={sheet} onClose={onClose} label={t('loc.send')} gap={12}>
      <View style={{ gap: 6 }}>
        <T size={20} w={700} ls={-0.03} accessibilityRole="header">{t('attach.location')}</T>
        <T size={13} lh={1.4} color={c.ink2}>{t('loc.intro')}</T>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput value={raw} onChangeText={setRaw} placeholder="-23.55052, -46.63331" placeholderTextColor={c.ink3} accessibilityLabel={t('loc.input.a11y')}
          autoCapitalize="none" autoCorrect={false} style={{ ...input, flex: 1, minWidth: 0, height: 50, fontSize: 15, fontFamily: fontFamily(500) }} />
        <Pressable onPress={paste} accessibilityRole="button" accessibilityLabel={t('loc.paste')}
          style={{ height: 50, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: c.line2, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="content_copy" size={17} />
          <T size={14} w={550}>{t('loc.paste')}</T>
        </Pressable>
      </View>
      <TextInput value={label} onChangeText={v => setLabel(v.slice(0, MAX_PLACE_LABEL))} placeholder={t('loc.placeName')} placeholderTextColor={c.ink3} accessibilityLabel={t('loc.placeName')}
        maxLength={MAX_PLACE_LABEL} style={{ ...input, height: 48, fontSize: 15, fontFamily: fontFamily(400) }} />
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 }}>
        <Icon name={loc ? 'location_on' : 'error'} size={16} color={c.ink2} />
        <T size={12.5} mono color={c.ink2}>{loc ? formatCoords(loc) : raw.trim() ? t('loc.invalid') : t('loc.nothing')}</T>
      </View>
      <Button label={t('loc.send')} disabled={!loc} onPress={() => { if (loc) sheet.current?.close(() => onSend(loc, cleanPlaceLabel(label))); }} />
    </Sheet>
  );
}

/** Balão de localização: nome do lugar, coordenadas, abrir no app de mapas e copiar. */
export function LocationBubble({ loc, label, inverse, onCopied }: { loc: Location; label: string; inverse: boolean; onCopied: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const fg = inverse ? c.invink : c.ink;
  const coords = formatCoords(loc);
  const chip = { height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 } as const;
  return (
    <View style={{ width: 236, gap: 8, paddingTop: 4, paddingBottom: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="location_on" size={21} color={inverse ? c.ink : c.invink} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={14.5} w={600} color={fg} numberOfLines={2}>{label || t('attach.location')}</T>
          <T size={11} mono color={fg} style={{ opacity: 0.75 }} selectable>{coords}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pressable onPress={() => { void Linking.openURL(mapUrl(loc, Platform.OS)).catch(() => {}); }} accessibilityRole="button" accessibilityLabel={t('loc.openMap')} hitSlop={6} style={chip}>
          <Icon name="map" size={14} color={fg} />
          <T size={11.5} w={600} color={fg}>{t('loc.openMap')}</T>
        </Pressable>
        <Pressable onPress={() => { void Clipboard.setStringAsync(coords).then(onCopied).catch(() => {}); }} accessibilityRole="button" accessibilityLabel={t('loc.copyCoords')} hitSlop={6} style={chip}>
          <Icon name="content_copy" size={14} color={fg} />
          <T size={11.5} w={600} color={fg}>{t('common.copy')}</T>
        </Pressable>
      </View>
    </View>
  );
}

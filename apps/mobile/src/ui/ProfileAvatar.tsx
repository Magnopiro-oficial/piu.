import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { anonChoices, anonColors, type AnonAvatar, pickProfilePhoto, sameAnon } from '../lib/avatar';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

/**
 * Avatar do Perfil (design: 96 px, tocável, com selo). Pública: foto ou iniciais, selo de câmera.
 * Anônima: imagem gerada (ícone + cor) ou o código da chave, selo de lápis; nunca a foto pública.
 */
export function ProfileAvatar({ pub, initials, keyCode }: { pub: boolean; initials: string; keyCode: string }) {
  const { c } = useTheme();
  const { profile } = useStore();
  const [open, setOpen] = useState(false);
  const radius = pub ? 48 : 28;
  const anon = profile.anonAvatar ?? null;
  const col = anon ? anonColors(anon) : null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button"
        accessibilityLabel={pub ? (profile.photo ? 'Foto do perfil público. Trocar' : 'Escolher foto do perfil público') : 'Imagem da identidade anônima. Trocar'}
        style={({ pressed }) => ({ width: 96, height: 96, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        {pub && profile.photo ? (
          <Image source={{ uri: profile.photo }} style={{ width: 96, height: 96, borderRadius: radius, backgroundColor: c.bg2 }} />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: radius, backgroundColor: col?.bg ?? c.ink, alignItems: 'center', justifyContent: 'center' }}>
            {!pub && anon
              ? <Icon name={anon.icon} size={50} fill color={col!.fg} />
              : <T size={32} w={650} ls={-0.03} color={c.invink}>{pub ? initials : keyCode}</T>}
          </View>
        )}
        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 34, height: 34, borderRadius: 17, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center',
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
          <Icon name={pub ? 'photo_camera' : 'edit'} size={18} />
        </View>
      </Pressable>
      {open && <AvatarSheet pub={pub} keyCode={keyCode} onClose={() => setOpen(false)} />}
    </>
  );
}

function AvatarSheet({ pub, keyCode, onClose }: { pub: boolean; keyCode: string; onClose: () => void }) {
  const { c } = useTheme();
  const { profile, setProfile, showToast } = useStore();
  const { setProfilePhoto } = useMessaging();
  const sheet = useRef<SheetHandle>(null);
  const [busy, setBusy] = useState(false);
  const seed = profile.anonSeed ?? 1;
  const tiles: (AnonAvatar | null)[] = [null, ...anonChoices(seed)];

  const choose = async (source: 'library' | 'camera') => {
    if (busy) return;
    setBusy(true);
    try {
      const p = await pickProfilePhoto(source);
      if (p) { setProfilePhoto(p); sheet.current?.close(); }
    } catch {
      showToast({ icon: 'error', title: 'Não foi possível usar a foto', body: 'Tente outra imagem.' });
    } finally { setBusy(false); }
  };

  const Option = ({ icon, title, sub, onPress }: { icon: 'photo_library' | 'photo_camera' | 'delete'; title: string; sub: string; onPress: () => void }) => (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 16, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={23} w={300} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={15.5} w={550}>{title}</T>
        <T size={12.5} color={c.ink2}>{sub}</T>
      </View>
    </Pressable>
  );

  const Note = ({ children }: { children: string }) => (
    <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
      <T size={12.5} lh={1.4} color={c.ink2}>{children}</T>
    </View>
  );

  return (
    <Sheet ref={sheet} onClose={onClose} label={pub ? 'Foto do perfil público' : 'Imagem anônima'}>
      <View style={{ gap: 4 }}>
        <T size={20} w={700} ls={-0.03} accessibilityRole="header">{pub ? 'Foto do perfil público' : 'Imagem anônima'}</T>
        <T size={13} lh={1.4} color={c.ink2}>{pub ? 'Quem tem seu contato público vê esta foto.' : 'Escolha uma imagem aleatória ou fique só com o código da chave.'}</T>
      </View>
      {pub ? (
        <>
          <View style={{ marginHorizontal: -10, gap: 2 }}>
            <Option icon="photo_library" title="Escolher da galeria" sub="Recortada em círculo, sem metadados" onPress={() => void choose('library')} />
            <Option icon="photo_camera" title="Tirar foto" sub="Câmera frontal" onPress={() => void choose('camera')} />
            {!!profile.photo && <Option icon="delete" title="Remover foto" sub="Volta para as iniciais" onPress={() => { setProfilePhoto(null); sheet.current?.close(); }} />}
          </View>
          {busy && <ActivityIndicator color={c.ink} />}
          <Note>Visível para os seus contatos públicos. Nunca aparece na identidade anônima.</Note>
        </>
      ) : (
        <>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, paddingVertical: 0 }}>
            {tiles.map((t, i) => {
              const on = sameAnon(profile.anonAvatar ?? null, t);
              const col = t ? anonColors(t) : null;
              return (
                <View key={i} style={{ width: '25%', alignItems: 'center' }}>
                  {/* Anel por fora, com folga (design: 0 0 0 3px fundo, 0 0 0 5px tinta). */}
                  <Pressable onPress={() => setProfile({ anonAvatar: t })} accessibilityRole="radio" accessibilityState={{ checked: on }}
                    accessibilityLabel={t ? `Imagem ${i}` : 'Só o código da chave'}
                    style={{ width: 74, height: 74, borderRadius: 24, borderWidth: 2, borderColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 64, height: 64, borderRadius: 19, backgroundColor: col?.bg ?? c.ink, alignItems: 'center', justifyContent: 'center' }}>
                      {t ? <Icon name={t.icon} size={32} fill color={col!.fg} /> : <T size={20} w={650} ls={-0.02} color={c.invink}>{keyCode}</T>}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Sortear outras" variant="soft" height={50} fontSize={14} style={{ flex: 1 }} left={<Icon name="shuffle" size={20} />}
              onPress={() => setProfile({ anonSeed: seed + 1 })} />
            <Button label="Pronto" height={50} style={{ flex: 1 }} onPress={() => sheet.current?.close()} />
          </View>
          <Note>Geradas aqui no aparelho. Nenhuma foto, nome ou dado seu. Evite usar a mesma imagem da identidade pública.</Note>
        </>
      )}
    </Sheet>
  );
}

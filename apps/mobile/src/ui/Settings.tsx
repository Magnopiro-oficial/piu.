import { Fragment, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Segmented, Toggle } from './Controls';
import { Icon, type IconName } from './Icon';
import { RadioDot } from './StepHeader';
import { T } from './T';

/** Grupo de ajustes: rótulo mono + cartão bg2 de raio 22 com divisórias. */
export function SetGroup({ title, children }: { title?: string; children: ReactNode }) {
  const { c } = useTheme();
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View>
      {title ? <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8 }}>{title}</T> : null}
      <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: c.line }} />}
            {r}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function Text2({ name, desc, weight = 550 }: { name: string; desc?: string; weight?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <T size={15} w={weight}>{name}</T>
      {desc ? <T size={12.5} lh={1.35} color={c.ink2}>{desc}</T> : null}
    </View>
  );
}

/** Linha com interruptor. */
export function ToggleRow({ icon, name, desc, on, onChange, disabled }: { icon?: IconName; name: string; desc?: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
      {icon && <Icon name={icon} size={21} w={300} />}
      <Text2 name={name} desc={desc} />
      <Toggle on={on} onChange={onChange} label={name} disabled={disabled} />
    </View>
  );
}

/** Linha com segmentado embaixo. */
export function SegRow<V extends string>({ name, desc, value, options, onChange }: { name: string; desc?: string; value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <View style={{ paddingVertical: 13, paddingHorizontal: 14, gap: 10 }}>
      <Text2 name={name} desc={desc} />
      <Segmented label={name} value={value} options={options} onChange={onChange} />
    </View>
  );
}

/** Linha que abre algo (valor à direita + chevron). `strong` = ação de peso 650. */
export function ActionRow({ icon, name, desc, value, onPress, strong }: { icon?: IconName; name: string; desc?: string; value?: string; onPress: () => void; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${name}, ${value}` : name}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: icon ? 16 : 14, backgroundColor: pressed ? c.bg3 : 'transparent' })}>
      {icon && <Icon name={icon} size={21} w={300} />}
      <Text2 name={name} desc={desc} weight={strong ? 650 : icon ? 450 : 550} />
      {value ? <T size={13} color={c.ink2}>{value}</T> : null}
      <Icon name="chevron_right" size={20} w={300} color={c.ink3} />
    </Pressable>
  );
}

/** Linha fixa (sempre ativa), com cadeado. */
export function LockedRow({ icon, name, desc }: { icon?: IconName; name: string; desc?: string }) {
  const { c } = useTheme();
  return (
    <View accessible accessibilityLabel={`${name}. ${desc ?? ''}. Sempre ativo`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
      {icon && <Icon name={icon} size={21} w={300} />}
      <Text2 name={name} desc={desc} />
      <Icon name="lock" size={18} w={300} color={c.ink2} />
    </View>
  );
}

/** Cartão de opção com ícone e rádio (backup, restaurar). */
export function OptionCard({ icon, title, desc, on, onPress }: { icon: IconName; title: string; desc: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${title}. ${desc}`}
      style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.bg2 : 'transparent' }}>
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={22} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={15.5} w={600}>{title}</T>
        <T size={13} lh={1.35} color={c.ink2}>{desc}</T>
      </View>
      <RadioDot on={on} />
    </Pressable>
  );
}

/** Nota de rodapé com ícone. */
export function FootNote({ icon, children }: { icon: IconName; children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, marginHorizontal: 24, marginBottom: 32 }}>
      <Icon name={icon} size={17} w={300} />
      <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}

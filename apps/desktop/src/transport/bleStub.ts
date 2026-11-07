/**
 * Bluetooth LE no computador: não existe (estado `unavailable` com o motivo; a tela Rede mostra "só no
 * celular"). A interface `Transport` aceitaria uma implementação sem mexer na camada de mensagens.
 * Alternativas avaliadas em 06/11/2026 (docs/auditoria-final-2026-11-06/desktop.md): Web Bluetooth é só
 * central e exige escolher o aparelho num seletor a cada conexão; @abandonware/noble (central) e bleno
 * (periférico) são módulos nativos por sistema e arquitetura, o bleno sem suporte no macOS recente, e
 * entrariam no pacote sem auditoria. Sem periférico, dois computadores nunca se achariam e o celular
 * teria de iniciar todo enlace.
 */
import { t } from '../shared/i18n';
import type { PeerInfo, TransportState } from '../shared/types';
import type { Transport, TransportEvent } from './types';

export class BleTransportStub implements Transport {
  readonly kind = 'ble' as const;
  readonly state: TransportState = 'unavailable';
  /**
   * Por que ainda não: o Electron não expõe Bluetooth LE no modo periférico (anunciar e aceitar conexões,
   * como o celular faz) e a Web Bluetooth só conecta a aparelhos escolhidos num seletor. A alternativa
   * (noble/bleno) é módulo nativo por sistema, quase sem manutenção no macOS recente, e exige permissão de
   * Bluetooth e assinatura revisadas no pacote.
   */
  get reason() { return t('main.ble.soon'); }
  readonly linkCount = 0;
  async start() { /* nada a ligar */ }
  async stop() { /* nada a desligar */ }
  async send(): Promise<void> { throw new Error(t('main.ble.unavailable')); }
  subscribe(_fn: (e: TransportEvent) => void) { return () => {}; }
  peerStatus(): PeerInfo[] { return []; }
}

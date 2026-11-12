import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';
import type { PiuMedium, PiuTransportEvents } from './PiuTransport.types';

declare class PiuTransportNativeModule extends NativeModule<PiuTransportEvents> {
  /** Meio principal: "nearby" no Android, "ble" no iPhone. */
  kind(): 'nearby' | 'ble';
  /** Meios deste aparelho: ["nearby", "ble"] no Android, ["ble"] no iPhone. Ausente em binários antigos. */
  media?(): PiuMedium[];
  /** Começa a anunciar e procurar vizinhos em todos os meios. `name` é o identificador curto do nó; `serviceId` separa redes. */
  start(name: string, serviceId: string): Promise<void>;
  stop(): Promise<void>;
  /** Envia um envelope (já cifrado) a um enlace conectado, pelo primeiro meio que o conheça. `data` em base64. */
  send(peerId: string, data: string): Promise<void>;
  /** Envia por um meio específico (a seleção de meio é feita em src/transport). */
  sendVia?(medium: PiuMedium, peerId: string, data: string): Promise<void>;
  /**
   * Android: liga/desliga o serviço em primeiro plano (aviso fixo) que mantém o transporte vivo em
   * segundo plano (Modo nó, Ponto Piu, "Receber com o app fechado"). Ligado, sobe a tarefa sem tela
   * `PiuCore` e guarda a escolha e o texto: religa sozinho se o sistema matar o processo e depois de
   * reiniciar o aparelho. iPhone: sem efeito.
   */
  setBackground?(on: boolean, title: string, text: string): Promise<void>;
  /**
   * "Procurar vizinhos" (NFR-004): intervalo entre varreduras, em segundos. Cada varredura dura poucos
   * segundos; intervalos curtos (Rápida) varrem sem parar. Conexões abertas não são afetadas.
   * Ausente em binários antigos.
   */
  setDiscoveryInterval?(seconds: number): void;
  /**
   * Android: liga/desliga um meio ("nearby" = Wi-Fi Direct, "ble") conforme a aba Rede. Desligado, ele
   * nem anuncia nem procura (o Nearby do Google Play Services liga o Wi-Fi sozinho). Chamado antes do
   * `start`, vale para ele. Ausente no iPhone e em binários antigos.
   */
  setMediumEnabled?(medium: PiuMedium, on: boolean): void;
  /**
   * Android: fora da otimização de bateria? E o fabricante/marca (Build.MANUFACTURER/BRAND), para a
   * Inicialização automática da Xiaomi. Ausente no iPhone e em binários antigos.
   */
  powerInfo?(): { ignoringBattery: boolean; manufacturer: string; brand: string };
  /** Android: pede a isenção de otimização de bateria (ou abre a lista). `false` se nenhuma tela abriu. */
  openBatteryExemption?(): boolean;
  /** Android (Xiaomi/HyperOS): abre a Inicialização automática, ou os detalhes do app. `false` se nada abriu. */
  openAutostart?(): boolean;
}

/**
 * `null` onde o módulo nativo não existe (web, Expo Go): o app usa o transporte simulado.
 * Precisa de um development build (`npx expo run:android|ios` ou EAS) para existir.
 */
export default requireOptionalNativeModule<PiuTransportNativeModule>('PiuTransport');

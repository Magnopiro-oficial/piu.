import type { AddLoraStep } from '../../lib/networkMap';
import { ConnectPiuSheet } from '../lora/ConnectPiuSheet';
import { ConnectRadioSheet } from '../lora/ConnectRadioSheet';
import { RadioTypeSheet } from '../lora/RadioTypeSheet';
import { RegionPicker } from '../lora/RegionPicker';
import { useLora } from '../lora/useLora';
import { usePiuLora } from '../lora/usePiuLora';

/**
 * "Conectar rádio LoRa" do mapa vazio: as mesmas folhas do "+" da linha LoRa da aba Rede (tipo de
 * rádio, Meshtastic, rádio do Piu e a região antes da primeira conexão). Conectou o Meshtastic: liga
 * o LoRa na aba Rede, como a linha faz.
 */
export function AddLoraSheets({ step, onStep, loraOn, turnOnLora, askPermission }: {
  step: AddLoraStep | null; onStep: (s: AddLoraStep | null) => void; loraOn: boolean; turnOnLora: () => void; askPermission: () => void;
}) {
  const mesh = useLora(), piu = usePiuLora();
  const close = () => onStep(null);
  const piuStep = () => onStep(piu?.link.region ? 'piu' : 'regionFirst');
  if (step === 'type') return <RadioTypeSheet onClose={close} onPick={k => (k === 'mesh' ? onStep('mesh') : piuStep())} />;
  if (step === 'mesh' && mesh) return <ConnectRadioSheet radio={mesh.radio} onConnected={() => { if (!loraOn) turnOnLora(); }} onClose={close} />;
  if (step === 'piu' && piu) return <ConnectPiuSheet radio={piu.radio} askPermission={askPermission} onRegion={() => onStep('region')} onClose={close} />;
  if ((step === 'region' || step === 'regionFirst') && piu) {
    return <RegionPicker link={piu.radio.link} first={step === 'regionFirst'} onDone={() => onStep(step === 'regionFirst' ? 'piu' : null)} onClose={close} />;
  }
  return null;
}

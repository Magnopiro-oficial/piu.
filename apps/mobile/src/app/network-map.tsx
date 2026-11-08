import { AddLoraSheets } from '../ui/map/AddLora';
import { NetworkMapView } from '../ui/map/MapView';
import { useNetworkMap } from '../ui/map/useNetworkMap';
import { Screen } from '../ui/Screen';

/** Mapa da rede (desenho Piu 18, direção Radar), aberto pelo radar da aba Rede: só o que o app conhece de verdade. */
export default function NetworkMap() {
  const { addLora, ...props } = useNetworkMap();
  return (
    <Screen>
      <NetworkMapView {...props} />
      <AddLoraSheets step={addLora.step} onStep={addLora.setStep} loraOn={addLora.loraOn} turnOnLora={addLora.turnOnLora} askPermission={addLora.askPermission} />
    </Screen>
  );
}

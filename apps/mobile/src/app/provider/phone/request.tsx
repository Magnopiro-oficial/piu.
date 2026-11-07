import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

/** Endereço antigo do pedido de aval (notificações já entregues): agora é o N6 com o pedido expandido. */
export default function PhoneRequestRedirect() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  return <Redirect href={(typeof c === 'string' ? `/provider/phone/requests?c=${encodeURIComponent(c)}` : '/provider/phone/requests') as Href} />;
}

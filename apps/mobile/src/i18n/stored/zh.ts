// 中文. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': '聊天请求 · 核对安全码',
  'stored.sub.e2e': '端到端加密',
  'stored.sub.nearby': '附近 · 端到端加密',
  'stored.sys.request': '对方先发了消息。信任之前请当面核对安全码。',
  'stored.sys.keys': '已交换密钥。消息在本设备上加密，只有联系人能读取。',
  'stored.sys.nearYou': '你已接受“附近”的请求。聊天为端到端加密。',
  'stored.sys.nearThem': '{name} 接受了你在“附近”的邀请。聊天为端到端加密。',
  'stored.sys.nearSomeone': '对方接受了你在“附近”的邀请。聊天为端到端加密。',
  'stored.sys.revoked': '此联系人撤销了一台丢失或被入侵的设备。信任新消息之前请当面核对安全码。',
  'stored.sys.leftChannel': '你已不在此频道中。',
  'stored.sys.removed': '你已被移除。密钥已更换：你将无法读取新内容。',
  'stored.sys.groupRevoked': '你撤销了一台设备。群组密钥已更换。',
  'stored.sys.group': '端到端加密群组。只有成员列表中的人拥有密钥。',
  'stored.sys.channel': '端到端加密频道。只有成员列表中的人拥有密钥。',
  'stored.sys.community': '端到端加密社区。只有成员列表中的人拥有密钥。',
};

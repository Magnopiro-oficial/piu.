// 日本語. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'チャットリクエスト · コードを確認',
  'stored.sub.e2e': 'エンドツーエンド暗号化',
  'stored.sub.nearby': '近く · エンドツーエンド暗号化',
  'stored.sys.request': 'この人が先にメッセージを送りました。信頼する前にセキュリティコードを直接確認してください。',
  'stored.sys.keys': '鍵を交換しました。メッセージはこの端末で暗号化され、相手だけが読めます。',
  'stored.sys.nearYou': '「近く」のリクエストを承認しました。チャットはエンドツーエンドで暗号化されています。',
  'stored.sys.nearThem': '{name}さんが「近く」の招待を承認しました。チャットはエンドツーエンドで暗号化されています。',
  'stored.sys.nearSomeone': '相手が「近く」の招待を承認しました。チャットはエンドツーエンドで暗号化されています。',
  'stored.sys.revoked': 'この連絡先は紛失または侵害された端末を無効にしました。新しいメッセージを信頼する前にセキュリティコードを直接確認してください。',
  'stored.sys.leftChannel': 'このチャンネルには参加していません。',
  'stored.sys.removed': '削除されました。鍵が変更されたため、新しい内容は読めません。',
  'stored.sys.groupRevoked': '端末を無効にしました。グループの鍵が変更されました。',
  'stored.sys.group': 'エンドツーエンド暗号化されたグループです。メンバー一覧にいる人だけが鍵を持っています。',
  'stored.sys.channel': 'エンドツーエンド暗号化されたチャンネルです。メンバー一覧にいる人だけが鍵を持っています。',
  'stored.sys.community': 'エンドツーエンド暗号化されたコミュニティです。メンバー一覧にいる人だけが鍵を持っています。',
};

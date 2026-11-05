// すべて架空のデータ。実在の個人・事業所とは無関係です。

import { ledgerIdOf } from './ledger/staffMap.js';

// transport_routes: 担当する送迎コース（台帳の transportRoute "1".."4" と対応）。運転手・送迎添乗のみ
const BASE_STAFF = [
  { id: 's01', name: '緑川 誠一', role: '事業所長', duties: ['事業所統括', '来客対応'] },
  { id: 's02', name: '岡田 健太', role: '理学療法士', duties: ['個別機能訓練'] },
  { id: 's03', name: '森下 彩', role: '理学療法士', duties: ['個別機能訓練'] },
  { id: 's04', name: '高橋 美和', role: '看護師', duties: ['バイタル', '服薬管理'] },
  { id: 's05', name: '野口 千春', role: '看護師', duties: ['バイタル', '服薬管理'] },
  { id: 's06', name: '村井 拓也', role: '生活相談員', duties: ['家族連絡', 'ケアマネ連携'] },
  { id: 's07', name: '竹内 康介', role: '運転手', duties: ['送迎(午前) コース1・2', '送迎(午後) コース1・2'], transport_routes: ['1', '2'] },
  { id: 's08', name: '長谷川 修', role: '運転手', duties: ['送迎(午前) コース3・4', '送迎(午後) コース3・4'], transport_routes: ['3', '4'] },
  { id: 's09', name: '石田 優子', role: '介護職員', duties: ['送迎添乗(午後) コース1・2'], transport_routes: ['1', '2'] },
  { id: 's10', name: '山口 翔太', role: '介護職員', duties: ['送迎添乗(午後) コース3・4'], transport_routes: ['3', '4'] },
  { id: 's11', name: '西村 恵', role: '介護職員', duties: ['入浴介助'] },
  { id: 's12', name: '前田 大輔', role: '介護職員', duties: ['入浴介助'] },
  { id: 's13', name: '藤井 さくら', role: '介護職員', duties: ['入浴介助'] },
  { id: 's14', name: '小林 直樹', role: '介護職員', duties: ['フロア'] },
  { id: 's15', name: '三浦 理恵', role: '介護職員', duties: ['フロア'] },
  { id: 's16', name: '中島 浩二', role: '介護職員', duties: ['フロア'] },
  { id: 's17', name: '井上 麻衣', role: '介護職員', duties: ['食事介助'] },
  { id: 's18', name: '清水 達也', role: '介護職員', duties: ['食事介助'] },
  { id: 's19', name: '松本 あかり', role: '介護職員', duties: ['レクリエーション'] },
  { id: 's20', name: '大野 健', role: '介護職員', duties: ['レクリエーション'] },
];

// 起動時に staff テーブルへ upsert して属性を同期する（id は不変）
export const STAFF = BASE_STAFF.map((s) => ({
  ...s,
  ledger_staff_id: ledgerIdOf(s.id),
  transport_routes: s.transport_routes || [],
}));

// Web UI のクイック挿入ボタン用サンプル連絡事項（利用者名は fixtures/ の200名台帳に実在する架空の氏名）
// label は画面のボタン表示用。expect は照合の想定（テスト・確認用）
export const DEMO_SAMPLES = [
  { label: '受診で早めの帰宅', expect: 'confirmed',
    raw_text: '坂井 夏子様、11/10（火）は午後に眼科受診のため15時に自宅へ送ってほしいとご家族から電話。クリニックへはご家族が同行。' },
  { label: '食事形態の変更', expect: 'confirmed',
    raw_text: '飯島 愛子さん、11/10（火）から食事形態を普通食から刻み食に変更。看護師より。' },
  { label: '姓のみ（候補選択）', expect: 'ambiguous',
    raw_text: '江口様のご家族から、次回の入浴時に右膝へ湿布を貼ってほしいとの依頼がありました。' },
  { label: '同姓同名（候補選択）', expect: 'ambiguous',
    raw_text: '新田 洋子さん 11/10（火）は発熱のため欠席とご家族から連絡。ケアマネにも共有済み。' },
  { label: '送迎車の点検', expect: 'none',
    raw_text: '送迎車2号車 11/10（火）午前は定期点検のため使用不可。コース1・2の便の組み替えが必要です。' },
  { label: 'レク内容の変更', expect: 'none',
    raw_text: '11/10（火）午後のレクリエーションは雨天予報のため、中庭での散歩から室内での音楽体操に変更します。' },
];

export const DEMO_MESSAGES = DEMO_SAMPLES.map((d) => d.raw_text);

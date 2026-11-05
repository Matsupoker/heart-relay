// HARMONIZE2 側の職員ID（台帳 S0001…）→ HEART RELAY 側の staff.id の対応表。
// 出典: fixtures/README.md「HEART RELAY 職員対応表」（すべて架空）。
// 所長・理学療法士・運転手は台帳の担当職員に含まれない。
export const LEDGER_STAFF_MAP = Object.freeze({
  S0001: 's04', // 高橋 美和（看護師）
  S0002: 's05', // 野口 千春（看護師）
  S0003: 's06', // 村井 拓也（生活相談員）
  S0004: 's09', // 石田 優子（介護職員）
  S0005: 's10', // 山口 翔太（介護職員）
  S0006: 's11', // 西村 恵（介護職員）
  S0007: 's12', // 前田 大輔（介護職員）
  S0008: 's13', // 藤井 さくら（介護職員）
  S0009: 's14', // 小林 直樹（介護職員）
  S0010: 's15', // 三浦 理恵（介護職員）
  S0011: 's16', // 中島 浩二（介護職員）
  S0012: 's17', // 井上 麻衣（介護職員）
  S0013: 's18', // 清水 達也（介護職員）
  S0014: 's19', // 松本 あかり（介護職員）
  S0015: 's20', // 大野 健（介護職員）
});

/** HEART RELAY の staff.id → 台帳の職員ID（対応が無ければ null） */
export function ledgerIdOf(staffId) {
  for (const [ledgerId, sid] of Object.entries(LEDGER_STAFF_MAP)) if (sid === staffId) return ledgerId;
  return null;
}

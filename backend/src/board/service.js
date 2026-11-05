// 共有ボード投稿の作成・取得（担当: board 作業系統。routes.js の send から insertBoardPost を呼ぶ）
import { newId, nowIso, parseJson } from '../http.js';

export const toBoardPost = (r) => ({
  id: r.id, message_id: r.message_id, title: r.title, body: r.body,
  urgency: r.urgency, categories: parseJson(r.categories_json, []),
  resident_name: r.resident_name ?? null,
  created_at: r.created_at, until: r.until ?? null, archived_at: r.archived_at ?? null,
});

/** 配信承認時に呼ばれる。post = {title, body, until} + 文脈 {urgency, categories, resident_name} */
export function insertBoardPost(db, { message_id, title, body, until = null, urgency = 'medium', categories = [], resident_name = null }) {
  const id = newId();
  db.prepare(`INSERT INTO board_posts (id,message_id,title,body,urgency,categories_json,resident_name,created_at,until)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, message_id, title, body, urgency, JSON.stringify(categories), resident_name, nowIso(), until);
  return toBoardPost(db.prepare('SELECT * FROM board_posts WHERE id=?').get(id));
}

export function getBoardPostByMessage(db, messageId) {
  const r = db.prepare('SELECT * FROM board_posts WHERE message_id=? ORDER BY created_at DESC LIMIT 1').get(messageId);
  return r ? toBoardPost(r) : null;
}

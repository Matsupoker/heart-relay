// 事業所 API（GET /api/offices, GET/POST /api/office-messages, POST /api/office-messages/:id/ack）— 実装は Issue #2 backend 作業系統
import express from 'express';

export function createOfficeRouter({ db }) {
  const router = express.Router();
  // TODO(office): docs/plan/Issue2_法人内連絡_設計_2026-11-07.md の §2 を実装する
  return router;
}

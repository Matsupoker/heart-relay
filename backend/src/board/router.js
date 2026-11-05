// 共有ボード API（GET /api/board, POST /api/board/:id/archive）— 実装は board 作業系統
import express from 'express';

export function createBoardRouter({ db }) {
  const router = express.Router();
  // TODO(board): GET / と POST /:id/archive を実装する（docs/api.md 参照）
  return router;
}

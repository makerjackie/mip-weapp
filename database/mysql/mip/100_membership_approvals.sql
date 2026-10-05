-- MIW-27 第二轮：新玩家首次支付会费后不立即成为会员，管理后台审核同意后资格才生效。
-- 每位用户至多一条审核记录：ledger 在回放首笔会员支付时自动创建 PENDING；
-- 管理后台决定后写回 decided_by/decided_at/decision_reason。REJECTED 之后复议
-- 通过（REJECTED -> APPROVED）走同一条记录，资格随链条重建恢复。
CREATE TABLE IF NOT EXISTS mip_membership_approvals (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  decision_reason VARCHAR(300) NULL,
  decided_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_at DATETIME(3) NULL,
  requested_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_membership_approvals_app_id_uk (app_id, id),
  UNIQUE KEY mip_membership_approvals_user_uk (app_id, user_id),
  KEY mip_membership_approvals_status_idx (app_id, status, requested_at, id),
  CONSTRAINT mip_membership_approvals_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_approvals_order_fk FOREIGN KEY (app_id, order_id)
    REFERENCES mip_orders (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_approvals_decider_fk FOREIGN KEY (app_id, decided_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_membership_approvals_status_ck CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

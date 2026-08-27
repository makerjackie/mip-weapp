CREATE TABLE IF NOT EXISTS mip_web_bff_requests (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal_identity_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, nonce),
  KEY mip_web_bff_requests_expiry_idx (expires_at, app_id, nonce),
  CONSTRAINT mip_web_bff_requests_nonce_ck CHECK (
    nonce REGEXP '^[A-Za-z0-9_-]{24,128}$'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

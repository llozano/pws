CREATE TABLE IF NOT EXISTS device_cluster_merges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_cluster_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_cluster_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_cluster_merges_source (source_cluster_id),
  KEY idx_device_cluster_merges_target (target_cluster_id, merged_at)
) ENGINE = InnoDB;

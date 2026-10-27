CREATE TABLE schema_migrations (
  version VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE = InnoDB;

CREATE TABLE device_clusters (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_device_clusters_updated_at (updated_at)
) ENGINE = InnoDB;

CREATE TABLE device_observations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cluster_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  architecture VARCHAR(40) NOT NULL,
  gpu_vendor VARCHAR(80) NOT NULL,
  gpu_model VARCHAR(256) NOT NULL,
  observation JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_device_observations_cluster (cluster_id, id),
  KEY idx_device_observations_candidates (platform, captured_at DESC),
  CONSTRAINT fk_device_observations_cluster
    FOREIGN KEY (cluster_id) REFERENCES device_clusters (id)
    ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE device_cluster_merges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_cluster_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_cluster_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_cluster_merges_source (source_cluster_id),
  KEY idx_device_cluster_merges_target (target_cluster_id, merged_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS device_clusters (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_device_clusters_updated_at (updated_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS device_observations (
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

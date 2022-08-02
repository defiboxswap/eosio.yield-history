/*
 Navicat Premium Data Transfer

 Source Server Type    : MySQL
 Source Schema         : history

 Target Server Type    : MySQL

*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ----------------------------
-- Table structure for dex_abis
-- ----------------------------
DROP TABLE IF EXISTS `dex_abis`;
CREATE TABLE `dex_abis`  (
  `account` char(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `abi` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  `block_num` bigint(20) NULL DEFAULT NULL,
  `update_time` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`account`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for dex_actions
-- ----------------------------
DROP TABLE IF EXISTS `dex_actions`;
CREATE TABLE `dex_actions`  (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `global_sequence` bigint(20) NOT NULL,
  `timestamp` datetime NULL DEFAULT NULL,
  `parent` bigint(11) NULL DEFAULT NULL,
  `block_num` bigint(20) NOT NULL,
  `trx_id` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `producer` varchar(13) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `account` varchar(13) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `name` varchar(13) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `authorization` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  `account_ram_deltas` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  `notified` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  `type` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 indicates new data, 2 indicates rollback',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `block_num`(`block_num`) USING BTREE,
  INDEX `global_sequence`(`global_sequence`) USING BTREE,
  INDEX `trx_id`(`trx_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for dex_blocks
-- ----------------------------
DROP TABLE IF EXISTS `dex_blocks`;
CREATE TABLE `dex_blocks`  (
  `block_num` bigint(20) NOT NULL,
  `block_id` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`block_num`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for dex_events
-- ----------------------------
DROP TABLE IF EXISTS `dex_events`;
CREATE TABLE `dex_events`  (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `type` tinyint(4) NOT NULL DEFAULT 1 COMMENT '1 indicates new data, 2 indicates rollback',
  `gs_ids` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT 'List of ids added or rolled back',
  `act_ids` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT 'List of ids added or rolled back',
  `block_num` bigint(20) NOT NULL,
  `timestamp` datetime NULL DEFAULT NULL,
  `status` tinyint(1) NULL DEFAULT 0 COMMENT 'Status, 0 unprocessed, 1 being processed, 2 completed',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `block_num`(`block_num`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for dex_status
-- ----------------------------
DROP TABLE IF EXISTS `dex_status`;
CREATE TABLE `dex_status`  (
  `head` bigint(20) NOT NULL,
  `irreversible` bigint(20) NULL DEFAULT NULL,
  PRIMARY KEY (`head`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;
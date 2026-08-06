-- 云端只读镜像的表结构。
--
-- 桌面版是唯一写入方，这里存的是它推上来的快照，网页端只读。
-- 因为不需要在云端做复杂查询，嵌套字段（latex / ai / images / topics）
-- 直接存 JSON 文本，省掉一堆关联表和拼装逻辑。
--
-- 保留 deletedAt 墓碑：桌面版删了题，推送时要能让云端也跟着删。

CREATE TABLE IF NOT EXISTS books (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  seq       INTEGER DEFAULT 0,
  createdAt INTEGER,
  updatedAt INTEGER,
  deletedAt INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id        TEXT PRIMARY KEY,
  bookId    TEXT NOT NULL,
  parentId  TEXT,
  title     TEXT NOT NULL,
  "order"   INTEGER DEFAULT 0,
  collapsed INTEGER DEFAULT 0,
  createdAt INTEGER,
  updatedAt INTEGER,
  deletedAt INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ch_book ON chapters(bookId);

CREATE TABLE IF NOT EXISTS problems (
  id               TEXT PRIMARY KEY,
  bookId           TEXT NOT NULL,
  chapterId        TEXT,
  no               INTEGER,
  title            TEXT,
  kind             TEXT,
  difficulty       INTEGER,
  difficultyManual INTEGER DEFAULT 0,
  mastery          INTEGER DEFAULT 0,
  starred          INTEGER DEFAULT 0,
  source           TEXT,
  note             TEXT,
  reasons          TEXT,   -- JSON array
  topics           TEXT,   -- JSON array
  latex            TEXT,   -- JSON {q,a,x}
  ai               TEXT,   -- JSON
  images           TEXT,   -- JSON [{id,slot,cap}]
  reviewCount      INTEGER DEFAULT 0,
  lastReviewAt     INTEGER DEFAULT 0,
  createdAt        INTEGER,
  updatedAt        INTEGER,
  deletedAt        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pr_book ON problems(bookId);
CREATE INDEX IF NOT EXISTS idx_pr_upd  ON problems(updatedAt);

-- 图片二进制在 R2，这里只记元数据
CREATE TABLE IF NOT EXISTS images (
  id        TEXT PRIMARY KEY,
  w         INTEGER,
  h         INTEGER,
  polarity  TEXT DEFAULT 'light',
  ext       TEXT DEFAULT 'webp',
  size      INTEGER,
  createdAt INTEGER
);

-- 同步元信息，只有一行
CREATE TABLE IF NOT EXISTS syncmeta (
  k TEXT PRIMARY KEY,
  v TEXT
);

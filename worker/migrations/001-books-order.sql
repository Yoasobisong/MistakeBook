-- 给 books 表补 order 列（书籍排列顺序）。
--
-- 为什么需要单独一份迁移：schema.sql 用的是 CREATE TABLE IF NOT EXISTS，
-- 对**已存在**的表什么都不做，所以老库不会自动长出新列。
--
-- 不加这一列的话，网页版的书籍顺序只能退回按 seq（历史题目数）排，
-- 跟你在桌面版拖出来的顺序对不上。
--
--   npx wrangler d1 execute cuotiben --remote --file migrations/001-books-order.sql
--
-- 报 "duplicate column name: order" 说明已经加过了，忽略即可。
-- 执行完到桌面版点一次「设置 → 云同步 → 全量重推」，把各书的 order 推上去。

ALTER TABLE books ADD COLUMN "order" INTEGER DEFAULT 0;

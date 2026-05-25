# Cloudflare 云端账号和数据同步配置

本分支新增了账号注册、登录和云端快照同步接口。前端仍然可以本地使用；只有登录后点击“上传云端 / 下载云端”才会同步 Token 列表和 BIN 数据。

## 需要在 Cloudflare 做的事

1. 在 Cloudflare 控制台创建一个 D1 数据库，例如 `xyzw-helper-db`。
2. 把 `migrations/0001_cloud_auth.sql` 里的 SQL 在 D1 数据库里执行一次。
3. 打开你的 Pages 项目，进入 `Settings` -> `Bindings`。
4. 新增 D1 binding：
   - Variable name: `DB`
   - D1 database: 选择刚创建的数据库
5. 重新部署 Pages 项目。

## 接口说明

- `POST /api/v1/auth/register` 注册账号
- `POST /api/v1/auth/login` 登录账号
- `GET /api/v1/auth/user` 获取当前账号
- `POST /api/v1/auth/logout` 退出登录
- `GET /api/v1/cloud/snapshot` 读取云端快照
- `PUT /api/v1/cloud/snapshot` 保存云端快照

## 保存的数据

云端快照会保存：

- `gameTokens` 里的游戏角色 Token 列表
- Token 分组
- 当前选中的 Token ID
- IndexedDB 里保存的 BIN / 微信扫码二进制数据

密码不会明文保存，后端使用 PBKDF2 和随机盐保存密码哈希。登录会话只保存会话 token 的 SHA-256 哈希。

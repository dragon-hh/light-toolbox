# 云开发部署

配置核验日期：2026-10-12。环境 `cloud1-6gjewz7jf1fbf260`，上海区域，AppID `wx5492d17de04b205d`。无需自购服务器或域名。客户端与云端现为 production，应用白名单限制解除，真实权益计费；单次 100 分、月卡 990 分，原生运行时读回一致。Android 单次卡及 iPhone 月卡首次付款已有证据，用户明确本版暂缓真实退款验收，未提交审核或公开发布。详见 [PRODUCTION.md](PRODUCTION.md)。

## 已部署资源

| 资源 | 配置与实测 |
|---|---|
| lightToolbox | Event / Nodejs20.19 / 1024 MB / 120 秒，Active |
| light_users / light_orders / light_jobs / light_receipts / light_uploads | 创建时设为 ADMINONLY；客户端直接查询五个集合均被拒绝 |
| 业务索引 | 按 cloud/indexes.json 创建，共 11 项自定义索引 |
| light-toolbox/input 与 results | 沿用 PRIVATE 存储权限，创建者及管理员可读写；处理和下载已联调 |
| lightMaintenance | 每 5 分钟运行；256 位随机服务端密钥鉴权，执行清理与对账 |

原有 10 个函数及 10 个集合保留。没有更改旧函数、没有购买或升级云套餐。自定义存储规则 API 返回 FreePackageDenied，现继续使用已验证的 PRIVATE 权限；不能宣称 results 仅服务端可读写。

云 API 显示环境正常、数据库运行中。账务接口返回旧「个人版」、未自动续费和历史到期时间；实际函数/数据库/存储操作成功，但这些返回不能证明长期免费或生产额度充足。正式公开前需核对后台当前可用额度及预算。

## 接入与更新

`cloud/` 是唯一云端源码，`npm run build:cloud` 生成 `cloudfunctions/lightToolbox`。不要直接修改生成代码。小程序 `miniprogram/config.js` 已启用 `transport: 'cloud'`，使用 wx.cloud.callFunction / uploadFile / downloadFile，四项工具的文件处理无需配置自购域名。

```powershell
# 官方 CLI 3.8.6，登录已完成；若过期按终端提示重新登录
npx --yes --package @cloudbase/cli@3.8.6 tcb login
npm run build:cloud
npm ci --prefix cloudfunctions/lightToolbox
npm test
npm run check
npm audit --omit=dev
npm audit --prefix cloudfunctions/lightToolbox --omit=dev

# 仅更新 lightToolbox 的代码，保留云端环境变量和触发器
npx --yes --package @cloudbase/cli@3.8.6 tcb fn code update lightToolbox -e cloud1-6gjewz7jf1fbf260 --json
# 等待函数 Active，再检查/配置维护触发器并实际调用
pwsh -File scripts/configure-maintenance.ps1
```

维护脚本使用 ignored 的 `output/cloudbaserc.development.json` 保存本机密钥，读取并保留远端其他环境变量；密钥不一致时明确停止。脚本不把密钥写入函数代码包，不创建商品或发起付款。不要打印完整 fn detail、环境变量或 timer CustomArgument。

SDK 依赖：wx-server-sdk 4.0.2、Node SDK 3.18.7、database 1.5.1，axios 平级 override 0.34.0。之前嵌套 override 被祖先依赖覆盖的根因已用干净目录解析验证，已改用官方新版依赖，未修改 node_modules。云端部署包也曾下载读回确认版本。Node SDK 数据库 set/update 使用直接对象，测试包含真实 SDK 序列化，避免误用小程序的 `{data: ...}` 契约。

## 运行模式

| LIGHT_MODE | 行为 |
|---|---|
| closed | 默认关闭；仅身份诊断接口返回调用者自身 OpenID |
| development | LIGHT_TEST_OPENIDS 白名单免费体验，不生成支付订单 |
| verification | 白名单真实付款验收，需要完整现网支付配置 |
| production | 公开付费；需要真实配置和 LIGHT_PRODUCTION_ENABLED=true |

只有服务端能决定权限和扣次；客户端按钮状态不是安全边界。verification 用于白名单真实付款验收。2026-10-12 用户明确要求本版暂缓真实退款验收，切换正式运行配置；生产开关与验收证据分离，LIGHT_PRODUCTION_ENABLED 表示运营授权，不据此设置 LIGHT_PAYMENT_VERIFIED。部署和实际读回见 [PRODUCTION.md](PRODUCTION.md)。

## 文件生命周期

原件上传前登记完整 fileID，防止丢失上传响应后无法枚举清理。原件处理成功即删；失败和中断原件 1 小时到期，正常情况下再延迟最多一个 5 分钟周期。结果也保留 1 小时，下载接口校验任务归属、成功状态及期限，随后 wx.cloud.downloadFile 用微信身份下载。

底层 PRIVATE 权限仍允许文件创建者在实际删除前直接访问；不把业务期限描述为存储权限会瞬间失效。维护故障会抛出异常并记录 requestId，不能把失败当成功；持续故障或每批超过 100 条积压可能延长清理时间，公开运营前应设置错误告警及容量监控。

定时触发身份独立于微信用户身份。真实联调发现暖实例可能残留 WX context，不能用「没有 OPENID」识别定时调用。函数验证 LIGHT_MAINTENANCE_TOKEN 与触发器 CustomArgument（事件 Message）一致；客户端不能伪造维护请求。

## 仍需外部接入

**真机选图当前阻塞：** 用户反馈 chooseMedia 未在生效隐私指引中声明。后端正常不代表该入口可用，先按 [PRIVACY_SETUP.md](PRIVACY_SETUP.md) 补齐后台声明，再真机验证。

1. 用户已确认虚拟支付、Apple IAP 开通；2026-10-12 确认 single=dragontoolbox02 / 100 分、month=dragontoolbox01 / 990 分正式价已发布，云端同步并读回。凭据及商品从被忽略的 .env.payment 合并，没有在代码包放密钥。Android 单次卡及 iPhone 月卡已有实际付款、到账、确认发货证据；iOS 单次卡及提前续期等仍需分别验证。
2. 支付通知采用微信原生云函数推送，处理代码已部署；用户已在开发者工具确认订阅，读回总开关和两项事件均启用。现为 production。无需创建 HTTP 回调域名；通知独立到达、重复通知及断网对账仍需真实验证，真实退款本版按用户决定暂缓。
3. 腾讯 BDA 人像分割已开通，凭据已通过本机 .env.portrait 和 scripts/configure-portrait.ps1 配置；原生页面 available=true，真实云任务、一寸蓝底 300 DPI 输出及原生下载已通过。尚需包含证件照用途的隐私指引生效和手机选图、相册保存验证，详见 VALIDATION.md。
4. 手机端选文件、相册授权、PDF 打开/转发仍需完整验收，模拟器通过不能代替。真实付款已验证的范围见 VALIDATION.md。

## 价格配置

页面和支付使用云端环境变量 `LIGHT_PRICE_SINGLE_FEN` / `LIGHT_PRICE_MONTH_FEN`，没有写死价格。调价只更新微信已发布道具和云端配置，无需重传代码。新部署在启动非 closed 模式前必须先提供这两项；现网为 100 / 990 分。详见 [PRICING.md](PRICING.md)。

## 虚拟支付部署和回调

商品：`dragontoolbox02` 单次 100 分，`dragontoolbox01` 月卡 990 分；用户确认正式价已发布、关联关系自定义。权益按服务端 SKU 映射；`XPAY_IOS_ENABLED=true`。密钥只保存在忽略文件及云环境变量。以下是初始接入到 verification 的流程；当前 production 的核验及管理使用 PRODUCTION.md 中的脚本。

```powershell
# 默认为只读；-Apply 暂存凭据，限 development
pwsh -NoProfile -File scripts/configure-payment.ps1
# 原生回调部署、订阅读回及商品发布确认后，显式启用白名单验收
pwsh -NoProfile -File scripts/configure-payment.ps1 -EnableVerification -Apply
# verification 部署的后续只读配置核验
pwsh -NoProfile -File scripts/configure-payment.ps1 -EnableVerification
```

配置脚本合并远端变量并核对读回，保留人像凭据、白名单、维护密钥、触发器和运行配置，不设置 `LIGHT_PAYMENT_VERIFIED`。生产部署不能通过此脚本修改。

当前官方 Nightly CLI 的 `cloud_query_msg_push` / `cloud_manage_msg_push` 已可用。先读全局订阅，防止同一事件覆盖其他环境；此次初始 callbacks 为空。订阅参数明确传两项事件，不能省略而默认订阅七项。用户确认后任务成功，读回 version=2，enable=true，pushMode=cloudfunction，两个 callbacks 均指向本环境 lightToolbox 并 enable=true。回执保存在 `output/payment-push-pending.json`（现 status=success，无待处理确认）。

原生函数入口与客户端共用调用面，不能信任 event 或暖实例的 WX context/SOURCE。通知仅触发微信查单：核对收件人、订单、商品、金额，verification 额外校验测试白名单；查单确认后发权益并主动调用 `notify_provide_goods`，失败保留待发货状态。退款查询原支付单，用权威 `left_fee` 验证累计退款，在事务内再校验当前订单。成功返回 JSON `ErrCode=0`；失败明确返回非零值和 requestId，等待平台重试。日志不包含密钥、完整消息或用户 OpenID。

`notify_provide_goods` 也必须带 `pay_sig`。接口单页简化参数表不能作为免签依据；首笔真机交易实际返回「签名字段[pay_sig]为空」，现已移除服务端免签开关，全部 XPay 请求强制按 URI 与实际 JSON 字节签名。错误码 268490002 同时可用于签名错误与数据不存在，后者必须核对明确的 providerMessage 才可记作尚未发起付款。

历史 HTTP 尝试：平台默认域名创建路由被官方预检拒绝为系统内部域名（requestId `01e52c22-e6ec-4689-8d32-833b23250a63`），没有创建路由，不得声称该 URL 可用。现采用原生云函数推送；不再绕过预检或调用废弃网关 API。保留的加密 HTTP 接收代码仅供另行配置的方案使用。

## 官方资料

- [云函数调用](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- [Node SDK 更新文档](https://docs.cloudbase.net/en/api-reference/server/node-sdk/database/update)
- [更新函数配置](https://cloud.tencent.com/document/product/583/18580)
- [更新定时触发器](https://cloud.tencent.com/document/product/583/96828)
- [云存储安全规则](https://docs.cloudbase.net/storage/security-rules)
- [腾讯 BDA 人像分割](https://cloud.tencent.com/document/api/1208/42970)

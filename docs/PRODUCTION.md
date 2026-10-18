# 正式运行配置

2026-10-12 用户要求切换正式运行配置，恢复单次 ¥1、月卡 ¥9.9 / 30 天，并明确本版暂缓真实退款验收。用户已确认两个微信道具的正式价格改好并发布。本次不包含上传、提交审核或公开发布小程序。

## 运行规则

- `LIGHT_MODE=production`：应用服务对具有有效微信身份的用户开放；已有测试白名单保留，但不再限制生产业务访问。
- `LIGHT_PRODUCTION_ENABLED=true`：表示运营者明确授权正式运行。它不代表付款、回调或退款验收全部通过。
- `LIGHT_PAYMENT_VERIFIED`：保留原值，不设为 true；本版暂缓真实退款验收。已有退款处理、撤权与幂等代码继续保留。
- `LIGHT_PRICE_SINGLE_FEN=100`、`LIGHT_PRICE_MONTH_FEN=990`：页面和签名共用服务端配置，下单仍核对用户看到的报价。旧订单金额与已购月卡有效期不变。
- 正式模式关闭 `/api/identity` 测试身份接口，客户端也不展示识别按钮。真实微信身份、权益扣次和文件归属校验继续执行，不授予免费次数。

## 部署

架构继续使用现有 `cloud1-6gjewz7jf1fbf260` 环境中的 `lightToolbox` 事件云函数、CloudBase NoSQL 和 PRIVATE 云存储。无需购买服务器或域名；微信原生支付消息推送、每 5 分钟维护触发器及原有业务资源不变。

先部署 `cloud/config.js` 生成的 `lib/config.js`，再应用环境变量，避免旧代码读取新开关时拒绝运行：

```powershell
npm run build:cloud
# 部署 lightToolbox 代码并确认成功后：
pwsh -NoProfile -File scripts/configure-production.ps1 -SingleFen 100 -MonthFen 990
# 仅在微信对应道具价格确已发布后应用：
pwsh -NoProfile -File scripts/configure-production.ps1 -SingleFen 100 -MonthFen 990 -WechatPricesConfirmed -Apply
```

配置脚本只合并模式、正式运行开关及两个价格字段，完整读回逐项核对；保留其他环境变量、角色、内存、超时及触发器。重复执行不重复更新。缺少微信价格确认、必要配置或读回不一致时明确失败，不记录密钥。

后续只改价格时继续用 `scripts/configure-prices.ps1`，操作见 [PRICING.md](PRICING.md)。如需恢复限制访问，应明确把服务端改回 verification，并使用测试客户端配置；不能用修改价格或伪造验收标记替代运行模式管理。

## 验证范围

- 100 项 Node 测试通过，包括生产模式非白名单访问、没有权益时拒绝处理、身份及文件访问限制、付款签名与计费事务。
- `tests/configure-production.test.ps1` 隔离测试通过：无确认拒绝、只读检查、配置保留、不泄露密钥、重复执行和错误读回。
- `npm run check` 通过：111 个源代码/配置文件、7 页原生 WXML/WXSS 编译。
- 既有 Android 单次卡及 iPhone 月卡真实付款证据保留，详见 [VALIDATION.md](VALIDATION.md) 与 [TEST_ACCESS.md](TEST_ACCESS.md)。上述测试不构成新的退款验收或正式发布。

## 实际部署结果

2026-10-12 完成增量更新 `lib/config.js`，任务 `confirmation_cloud_fn_inc_deploy_7ce8e57f-d8b6-49bf-82e2-c8faac97398a` 读回 `status=success`、`detail=execution_success`。随后配置脚本应用成功，函数 `Active`，只改变 LIGHT_MODE、LIGHT_PRICE_MONTH_FEN 并新增 LIGHT_PRODUCTION_ENABLED；单次价格原本即为 100 分。

- 所有其他环境变量、触发器、角色、运行时、内存和超时逐项读回一致；没有改写 LIGHT_PAYMENT_VERIFIED。
- 官方模拟器真实调用 `/api/config` 返回 production、100 / 990 分、iosEnabled=true；`/api/identity` 返回 IDENTITY_UNAVAILABLE。
- 同一原有账户切换前后 `isMember=true`、`memberUntil=1794321773000`、`credits=0` 逐项一致。未发起新订单、支付、退款或工具处理。
- 原生首页和会员页真实加载均显示 1 / 9.9，月卡日均 0.33，`local=false`、无页面错误；生效会员默认保持续期区收起。
- 官方首页开发预览成功，二维码 `output/LIGHT-production-preview-20261012.jpg`；兼容旧入口 `output/LIGHT-no-copy-preview.jpg` 同步更新。新二维码仅为开发预览，仍受微信平台成员权限限制，不是公开访问码。

回执在 `output/production-20261012/`：`deployment-receipt.json`、`configuration-applied.json`、`runtime-before.json`、`runtime-after.json`、`member-page.json`、`home-page.json`、`preview-receipt.json`。没有上传版本、提交审核或公开发布。微信后台道具正式价格以用户“已改价并发布”的确认作为依据，本轮没有读取后台私有接口。

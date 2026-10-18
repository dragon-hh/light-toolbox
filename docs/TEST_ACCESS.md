# 测试账号识别

当前状态：2026-10-12 已按用户要求切换 production，应用内测试白名单限制解除，以下识别流程仅供以后 verification 测试使用。正式配置已关闭身份识别接口及按钮。开发预览和体验版仍受微信平台成员权限限制，不等于公开发布；见 [PRODUCTION.md](PRODUCTION.md)。

2026-10-12 增加独立页面 `pages/test-identity/index`。此入口只负责识别本人，不自动开通权限，也不代表已经拥有次数或月卡。

1. 测试者使用本人微信扫描直达该页的开发预览二维码；微信后台的开发版访问资格须单独具备。
2. 点击“获取我的识别码”，将成功页截图交给邀请人。截图中的 OpenID 仅用于核对和追加测试白名单，不是密码。
3. 管理员核对截图来自指定受邀账号，再将该 OpenID 追加到 `LIGHT_TEST_OPENIDS`，保留原有账号及其他配置。微信号不能代替 OpenID，不能凭相近扫码时间推定身份。
4. 追加并读回后，测试者重新进入工具箱。verification 模式仍真实付费；识别页不授予免费次数。

`GET /api/identity` 校验微信云函数上下文中的 AppID 和 OPENID，只在 closed/development/verification 返回调用者自己的标识。请求参数不能指定被查询人；其他业务 API 仍执行白名单校验。生产模式明确拒绝识别接口。页面仅在非正式测试包显示按钮，不读相册、不使用剪贴板、不存储身份标识；日志只记录请求编号与状态。

## 本次验证

- 99 项测试通过，包含未入白名单账号识别、跨 AppID/缺失身份拒绝、伪造请求身份无效、业务接口仍拦截、生产禁用及页面失败展示。
- `npm run check` 通过，111 个源码/配置文件、7 个原生页面，WXML/WXSS 编译通过。
- 官方工具确认后，增量部署仅更新 lightToolbox 的 `lib/handler.js`（4.1 KB）。现有环境变量、触发器、运行时、角色、超时和内存逐字节序列化摘要核对一致。首次核对曾受 PowerShell Hashtable 顶层字段顺序影响；按部署前相同字段顺序重新计算后匹配，未修改任何云配置。
- 官方模拟器识别真实当前账号成功，只保存 `identified=true` 与长度等验证信息，没有把 OpenID 写入日志/验证文件。未冒充受邀账号；该账号仍须本人扫码并提供识别页。
- 开发预览二维码：`output/LIGHT-test-identity-preview-20261012.jpg`，入口 `pages/test-identity/index`。本次未上传体验版、未提交正式审核或发布。
- 部署、预览与验证回执：`output/test-identity-20261012/`。发生回归可从该目录 `before/cloud/handler.js` 恢复源码、重新构建并增量部署；只回退此次识别功能。

## 受邀账号加入测试

2026-10-12，用户提供受邀账号本人识别码后，已追加到云端 `LIGHT_TEST_OPENIDS` 并读回确认：测试账号从 1 个增至 2 个，原账号保留。仅变更白名单；其余环境变量、触发器、运行时、角色、超时和内存逐项一致。仍为 verification 模式，单次 100 分、月卡测试价 110 分；未赠送次数或月卡。验证回执 `output/test-identity-20261012/invitee-added.json` 不含 OpenID。该账号真机进入及工具使用还须本人实际验证，配置成功不代表已完成真机验收。

用户随后报告支付成功；官方云数据库只读查询该账号全部订单（共 1 笔）确认：月卡订单 `REDACTED_IOS_MONTH_ORDER`，110 分，2026-10-12 22:24:49（北京时间）支付，`status=paid`、`delivered=true`、`platform_state=found`。按现行订单权益算法，月卡有效至 2026-11-11 22:24:49。没有手工写订单或赠送权益。回执为 `invitee-orders-readback.json` 与 `invitee-payment-confirmed.json`；均不含 OpenID。用户明确确认本次为 iPhone：iOS 月卡首次购买、权益到账和发货确认通过。此证据不覆盖 iOS 单次卡、真实退款、提前续期、退出支付后的通知到账或全部工具真机验收，不设置 LIGHT_PAYMENT_VERIFIED。

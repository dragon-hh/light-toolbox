# 接入与部署

最后配置核验：2026-10-12。以下状态需要真实账号配置，不能由编译或单元测试代替。

**当前部署方向已改为用户现有的微信云开发环境，不要求自购服务器和域名。** 云端已部署，当前状态见 [CLOUDBASE.md](CLOUDBASE.md)。下面第 4–5 节是保留的 Express/SQLite 自建后端方案，只是可选方案，不是微信小程序或云开发的强制要求。

## 1. 已确定的商品

| SKU | 已发布 ProductId | 商品含义 | 微信后台单价（分） |
|---|---|---|---:|
| single | dragontoolbox02 | 任一工具成功使用一次 | 100 |
| month | dragontoolbox01 | 全部工具连续 30 天使用权，手动续费 | 990 |

用户已确认所有终端统一 ¥1/次，不再使用最初讨论的 ¥0.99。月卡不属于自动续费订阅，不签约连续包月。PDF 一组合并、压缩一张图片、生成一张证件照、随机抽取一轮分别计一次。

2026-10-11 用户确认两项商品均已发布，关联关系自定义，Apple IAP 已开通。云端凭据及商品 ID 已配置，原生支付/退款消息订阅已启用。2026-10-12 按用户要求切换 production，应用白名单限制解除，仍按真实权益计费，未公开发布。Android 首笔 ¥1 单次卡已支付、到账并确认发货；2026-10-12 用户确认 iPhone 月卡测试订单 ¥1.1 已付款，云端读回 paid / delivered=true，权益生效。iOS 单次卡、提前续期、退出支付后的通知到账仍待独立验收；本版按用户决定暂缓真实退款验收，详见 PRODUCTION.md、VALIDATION.md 与 TEST_ACCESS.md。

价格已改为云端配置；用户已确认微信正式价 ¥1 / ¥9.9 发布，云端同步并读回成功。以后只同步微信道具和云端价格配置，不改代码或重传包。见 [调价操作](PRICING.md)。

## 2. 微信后台必须完成

- 主体为个人，服务类目包含「工具」，完成小程序认证和备案。
- 「支付与交易 → 虚拟支付」完成开通、资料审核及签约。
- 「道具管理」创建上表两项商品并**发布**。将实际道具 ID 写入服务端，不要把 SKU 当成后台真实商品 ID。
- 「基本配置」取得 OfferID 和**现网** AppKey。
- 如需 iOS 支付，配置小程序简称并开通 Apple IAP。
- 配置微信客服账号，支持小程序中的 `open-type="contact"` 入口。
- 配置隐私保护指引中的图片、文件、相册、OpenID 等实际处理用途；如使用腾讯人像分割，说明第三方处理。

根据当前官方文档，个人主体全终端月支付限额为 10 万元。安卓等终端费率 1%，结算 T+3；iOS 费率 12%，通常自然月结束后 45–60 天结算。iOS 端至少 iOS 15、微信 8.0.68，单笔至少 ¥1，需中国大陆 App Store 账号。iOS 退款由用户在 App Store 申请，开发者不能主动退款；其他终端可在后台处理。以正式账号后台最新规则为准。

## 3. 服务端私密配置

根目录 `.env` 已加入 `.gitignore`，按 `.env.example` 填写：

| 环境变量 | 来源 / 用途 |
|---|---|
| APP_MODE | 仅本地后端 local / production |
| LIGHT_MODE | 云端 development / verification / production，详见 CLOUDBASE.md |
| LIGHT_TEST_OPENIDS | 云端开发和付款验收阶段的测试账号白名单 |
| LIGHT_MAINTENANCE_TOKEN | 服务端维护密钥，由维护脚本配置；不交给客户端 |
| LIGHT_PRODUCTION_ENABLED | 正式运行授权开关；production 必须为 true，不代表验收全部通过 |
| LIGHT_PAYMENT_VERIFIED | 验收证据标记，本版暂缓真实退款验收，不设置 true，不作为运行门禁 |
| WECHAT_APP_ID | 已确认 `wx5492d17de04b205d` |
| WECHAT_APP_SECRET | 微信后台的小程序 AppSecret，服务端登录和 access_token |
| XPAY_OFFER_ID / XPAY_APP_KEY | 虚拟支付基本配置，使用现网 AppKey |
| XPAY_PRODUCT_SINGLE / XPAY_PRODUCT_MONTH | 已发布的 100 分 / 990 分道具 ID |
| XPAY_IOS_ENABLED | 后台实际开通 IAP 后才设 true |
| WECHAT_PUSH_TOKEN | 消息推送 Token，开发者设置，与后台一致 |
| WECHAT_PUSH_AES_KEY | 消息推送 EncodingAESKey，43 字符，安全模式 |
| WECHAT_ORIGINAL_ID | 小程序原始 ID（通常 gh_ 开头），用于校验收件人 |
| SESSION_ENCRYPTION_KEY | 32 字节随机数的十六进制，保护数据库内 session_key |
| TENCENT_SECRET_ID / TENCENT_SECRET_KEY | 仅授权必要 BDA 人像分割能力的腾讯云凭据 |
| TENCENT_REGION | 默认 ap-guangzhou |
| DATA_DIR | 私有持久化目录，正式部署建议 /data |

`SESSION_ENCRYPTION_KEY` 已在初始化本地 `.env` 时生成；不要随意轮换，否则旧会话无法解密。不得在日志或截图展示完整密钥。生产环境必须由运行平台安全注入这些值，不要打进镜像。

`WECHAT_PUSH_TOKEN` 和 `WECHAT_PUSH_AES_KEY` 已生成并配置到云端，供可选 HTTP 安全模式使用，当前原生云函数消息推送不依赖 HTTP 回显或这两个密钥。实际订阅状态及部署步骤见 [CLOUDBASE.md](CLOUDBASE.md#虚拟支付部署和回调)。

腾讯云需开通人体分析的人像分割服务。调用的是 BDA `2020-03-24 / SegmentPortraitPic`，图片以 Base64 发送，返回透明 PNG，再由 Sharp 裁切/换背景。服务可能产生调用费用；2026-10-11 已完成本地和云端各一次真实人像调用。

2026-10-11 用户已开通服务并填写凭据，lightToolbox 的凭据已部署并经真实生成、原生下载验证。官方直接入口为 [人像分割控制台](https://console.cloud.tencent.com/bda/segment-portrait-pic)。后续轮换密钥仍按以下流程配置。

在项目根目录被 Git 忽略的 `.env.portrait` 填写 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_REGION=ap-guangzhou`，值不加引号，不要在聊天或日志中展示。建议使用仅授权 `bda:SegmentPortraitPic` 的子账号密钥。执行流程：

```powershell
# 只读检查：输出将更新的字段名，不显示密钥
pwsh -NoProfile -File scripts/configure-portrait.ps1
# 合并现有环境变量，仅更新 lightToolbox 的三项人像配置，再读回验证
pwsh -NoProfile -File scripts/configure-portrait.ps1 -Apply
# 配置脚本回归测试，使用合成凭据，不访问云端
pwsh -NoProfile -File tests/portrait-setup.tests.ps1
```

脚本只允许现有 development 环境，不覆盖支付、白名单、维护密钥、运行角色和触发器；缺失凭据时在访问云端前失败。配置读回成功后仍需测试真实人像分割、图片生成和手机保存，不得直接标记功能验收完成。

## 4. 部署服务端

运行时为 Node.js 24+、Sharp、pdf-lib、SQLite。`Dockerfile` 可用于有持久化存储的服务器或容器平台。

```powershell
docker build -t light-toolbox .
# .env 必须先填好；生产仅经 HTTPS 反向代理访问，数据卷必须长期保留。
docker run --env-file .env -e APP_MODE=production -e DATA_DIR=/data -p 127.0.0.1:8787:8787 -v light-toolbox-data:/data --name light-toolbox light-toolbox
```

反向代理要求：有效 TLS 证书、请求体上限至少 45MB、上游超时至少 90 秒。健康检查 `GET /health`。不把 `data/` 映射成静态目录，不让多个应用副本同时使用该 SQLite 文件。`X-Forwarded-For` 仅信任回环反向代理；如使用不同网络拓扑，需要显式调整信任范围。

原始文件请求内存上限：每文件 10MB、每批 40MB，最多 4 个同时上传/处理请求，单用户最多 2 个正在处理任务。图片最多 4000 万像素。PDF 最多 500 页。

后台每 5 分钟对未完成订单查单；已付款且未确认发货的订单补通知；过去 180 天的已付款订单轮转复查（每天一次）。每批最多 100 条，并写入 last_checked 及失败事件。积压或支付服务故障需要告警，不能把未确认订单标为成功。

`npm run reconcile` 可手动执行一轮。单笔失败会留下订单级日志；本轮有失败时命令以非零状态退出，不把局部失败当作整轮成功。

## 5. 可选 HTTP 消息推送及真机域名

当前部署使用原生云函数推送，不需执行本节；以下仅供另行部署 Express/SQLite 后端时使用。

微信后台「开发与服务 → 开发管理 → 消息推送」：

- URL：你的正式域名 + `/api/pay/notify`。
- Token / EncodingAESKey 与环境变量一致。
- 选择**安全模式（加密）和 XML**。
- 订阅 `xpay_goods_deliver_notify` 和 `xpay_refund_notify`。
- 不要将投诉/风控/订阅等未实现事件指向此 URL。未支持事件会明确记录并返回错误，需要独立配置相应业务处理器。

GET 路径验证 `signature` 后原样返回 `echostr`；POST 用 `msg_signature` 验签、AES 解密、校验 AppID 和小程序原始 ID。支付通知进一步核对 OpenID、道具、数量及金额，再用微信服务端 `query_order` 确认付款。以业务单号和微信平台单号唯一约束保证发货幂等。

`query_order` 使用 `order_id`，现网 `env:0`，API 原始 JSON 字符串与 HMAC 输入一致。客户端 `success` 不发权益。查单补发时权益事务先提交，再调用 `notify_provide_goods`；网络失败保留未确认状态供后续重试，不重复发权益。

小程序端 `miniprogram/config.js`：

```javascript
module.exports = { apiBase: 'https://你的实际API域名', mode: 'production' };
```

微信后台添加 request / downloadFile 合法域名。可选 HTTP 后端上传实现使用带二进制 multipart 的 `wx.request`，一次请求传完整 PDF 组；真机需重点验证 40MB 上限和超时体验。照片和文件处理前请求隐私授权，保存到相册单独处理权限。

## 6. 官方调试工具

本次下载官方 Nightly **2.02.2610092（2026-10-09）**，安装包通过腾讯签名校验。已独立解压到 `output/wechat-nightly/`，**没有覆盖原有安装、没有修改全局 PATH**。其 `wechatide-skill` 为 0.3.11，官方安装诊断已返回 `compatible:true`。

```powershell
# 先打开本目录下的微信开发者工具.exe 完成登录；首次需允许 Codex 连接。
$nightlyRoot = Join-Path $PWD.Path 'output/wechat-nightly'
Start-Process -WindowStyle Hidden -FilePath (Join-Path $nightlyRoot '微信开发者工具.exe') -WorkingDirectory $nightlyRoot
& '.\output\wechat-nightly\wechatide.cmd' -c Codex check_wechatide_status --skill-version 0.3.11
& '.\output\wechat-nightly\wechatide.cmd' -c Codex open_project_window --project $PWD.Path --window-mode fullMode
```

需以当前工具帮助为准，旧版本的 `-t project_open_window` 不是本版本推荐命令。官方根 Skill 路径：`output/wechat-nightly/resources/app.asar.unpacked/wechatide-skill/SKILL.md`。

下载包和解压环境位于 ignored 的 output 目录，若清理它们，需要重新准备工具。项目源码不依赖该目录。

本次已完成开发者工具登录和 Codex 授权。基础库固定为已验证的 3.17.3。本地 `project.private.config.json` 仅为模拟器访问 `127.0.0.1` 关闭域名校验，已被 Git 忽略；共享配置仍保留 `urlCheck:true`。手机不能连接电脑的 `127.0.0.1`。当前客户端使用云开发 production，不依赖电脑本地后端；应用内测试白名单限制已解除，但开发预览或体验版仍受微信平台成员权限限制，尚未公开发布。

## 7. 正式上线前验收

1. 微信真实登录；刷新 session_key 后发起支付；同一账号重新进入仍有订单与权益。
2. Android / iOS 分别买 ¥1 使用权，核对微信账单金额和后台道具。
3. 关闭支付页或退出小程序，验证推送/对账仍然发放一次权益；重复通知不重复发放。
4. 单次成功消费；损坏 PDF、无人物照片、网络中断等失败不吞错、不多扣。
5. 买月卡和提前续费，核对 30 天、到期边界及不自动扣款。
6. 退款后撤回对应权益；部分退款产生可人工核对的状态。
7. 大文件、相册权限拒绝、隐私授权拒绝、文件过期、断网后从记录恢复。
8. 配置客服、正式隐私指引、备案、必要服务类目与费用；审阅页面文案后提交微信审核。

尚未完成真实环境验收前，不得把本地模拟测试当成「已收款」「已上线」或「证件照服务已开通」。

## 官方资料

- [个人主体虚拟支付接入](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)
- [虚拟支付完整协议与 iOS 条件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
- [wx.requestVirtualPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)
- [query_order](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html)
- [notify_provide_goods](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods.html)
- [腾讯人像分割](https://cloud.tencent.com/document/api/1208/42970)
- [Nightly 官方下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/nightly.html)

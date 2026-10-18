# 开发验收记录

日期：2026-10-11；分支：feat/light-payment-push；AppID：wx5492d17de04b205d。

## 当前结论

代码及云端环境已交付。四项工具均已在微信 Nightly 模拟器通过真实云函数完成处理；证件照已接通腾讯 BDA 并验证生成和原生下载。2026-10-12 按用户要求将客户端与云端切换 production，价格恢复单次 ¥1、月卡 ¥9.9 / 30 天；云函数 Active，原生页面与接口读回一致，已有权益不变，测试身份接口关闭。100 项 Node 测试、配置脚本隔离测试及 7 页原生编译通过，详见 [正式运行配置](PRODUCTION.md)。

首笔 Android 真机 ¥1 订单已支付、到账 1 次并完成发货确认；修复了该订单暴露的确认发货漏签问题。2026-10-12 新测试账号在 iPhone 上购买 ¥1.1 月卡，用户确认手机平台，官方云数据库确认 paid / delivered=true，月卡有效至 2026-11-11 22:24:49（北京时间），证据见 [测试账号与付款验证](TEST_ACCESS.md)。iOS 单次卡、提前续期和退出支付后的通知到账仍待独立验收；真实退款本版按用户决定暂缓，不设置 LIGHT_PAYMENT_VERIFIED。隐私指引生效、手机选择器和保存相册仍单独待验收，本轮未提交审核或公开发布。

## 真机隐私问题（用户反馈后的状态更正）

用户截图确认 chooseMedia 被后台隐私声明拦截。之前的素材预置/选择器模拟验证了云端处理链路，没有验证真实手机选择器准入，不能视为真机工具入口验收通过。后续审核通知确认本次隐私指引被驳回，尚未代用户修改后台；修订建议见 [PRIVACY_SETUP.md](PRIVACY_SETUP.md)。

中文提示和原始 errno/errMsg 日志已补充，针对声明缺失与用户拒绝的区分增加回归测试；这不代表后台问题已解决。

用户随后报告后台设置成功。2026-10-11 13:00 复测：恢复真实 chooseMedia 后点击图像压缩选图，模拟器仍返回 errno=112 / PRIVACY_DECLARATION_MISSING；截图 output/wechat-privacy-retest.jpg。getPrivacySetting 返回 needAuthorization=false，只反映当前授权状态，不能证明接口声明已经生效。用户手机复测结果待确认；当前不能标记隐私问题已解决。

后续用户提供审核不通过通知：指引提交时间为 2026-10-11 12:58:49，驳回原因是「收集你选中的照片或视频信息接口」说明内容不符合接口使用场景。用户确认提交原文为「图片压缩、证件照制作」。首次修订按当时已接通的压缩能力说明用途；后续证件照真实接通后已将其用途补回填写建议。仅修改了项目说明，没有后台重新提交、审核通过或手机选图成功证据。

## 自动化和依赖

- `npm test`：63 项通过，0 失败。覆盖微信官方签名向量、加密推送、金额校验、幂等发货、退款撤权、月卡顺延、并发扣次、失败释放、文件权限/过期、原生云下载，以及原生通知伪造、重复通知、发货重试、退款权威查单、尚未注册支付订单的明确状态；新增发货实际 HTTP 签名、真实适配器贯穿回调、复用错误码不掩盖签名失败的回归测试。
- 文件处理使用真实 Sharp / pdf-lib；PDF 页序、图像解码/透明通道、证件照尺寸和 DPI 已验证。自动化单测的人像分割使用受控结果；另已通过下述独立真实 BDA 联调，不能混淆两者。
- 云数据库测试既有业务事务替身，也有真实 Node SDK 网络边界序列化测试，验证 set/update 和事务文档结构。
- `npm run check`：92 个源代码/配置文件、6 个原生页面；WXML/WXSS 原生编译通过，检查过程未改变源文件。
- 根项目和独立云函数包分别执行 `npm audit --omit=dev`：均 0 漏洞。结果在 output/audit-local.json 和 output/audit-cloud.json。

## 真实云端联调

环境 cloud1-6gjewz7jf1fbf260，lightToolbox 已部署 Nodejs20.19 / 1024 MB / 120 秒。下列工具验收发生于 development 阶段；随后以 verification 验证白名单真实付款，2026-10-12 按用户要求切换 production，最新状态以上方当前结论及 PRODUCTION.md 为准。

| 工具 | 输入与结果 | 真实云任务 ID |
|---|---|---|
| 幸运转盘 | 6 个示例图文选项，等概率真实抽中第 5 项，旋转 2280° 后与顶端指针对齐；下一轮第 4 项，累计 4500° | 34ebc317-b6cd-4c81-a5a3-b1741dc71fb3 / c3672354-fba0-4d07-b764-828b573ca4b6 |
| PDF 合并 | 2 个测试 PDF 合并，结果 2 页 | 1ed95ca6-b7e4-4f3d-9727-7286688b5af7 |
| 图像压缩 | 94,535 字节 PNG → 3,308 字节 JPEG，缩小 97% | 25cb063a-8134-4de2-9664-0d695489626e |
| 证件照 | NASA 公开样图 → 295×413 px、300 DPI 蓝底 JPEG，41,062 字节；原生下载并显示 | f26e40c9-954a-4501-8d0e-949689becd25 |

- 原生首页和记录页正常渲染，截图 output/wechat-cloud-home.jpg、output/wechat-cloud-records.jpg。
- 官方 create_preview_qrcode 已成功，预览包 93,797 字节，二维码 output/LIGHT-preview.jpg。仅生成开发预览，未提交审核或公开发布。
- 源码安全检查覆盖 104 个可入库文件，未发现本机已配置密钥。
- 原生会员页读取 local=true，测试支付禁用；证件照在凭据配置前 available=false，配置并真实验证后读取为 true。
- 记录页通过 wx.cloud.downloadFile 下载压缩结果，微信图片预览实际显示测试图；截图 output/wechat-cloud-compress-result.jpg。
- PDF 与图片结果均确认可下载；真机 PDF 打开与转发未验收。
- 五个业务集合设置 ADMINONLY，原生客户端直接读均返回 -502003 Permission denied。
- 存储权限仍为 PRIVATE；自定义规则因免费套餐被拒绝，未升级套餐。已验证结果绑定调用者，拥有者可通过原生云存储下载。未将其描述成服务端独占读取。
- 维护函数经过带随机密钥的真实调用成功，清除 1 条从未上传的到期测试记录（requestId ea7bc661-5d00-4d8f-af40-7ff869a9ef41），支付在 development 返回 disabled。维护配置脚本实际执行 exit 0。另建到期测试记录 b328ab1fd5b054f7ea01152eb0fc5362cef6c33f85a30f40，临时用每分钟调度验证：12:48 后在没有手动维护调用的情况下读回为空，确认自动触发清理成功；随后恢复每 5 分钟。
- 从真实部署包读回过 Node SDK 3.18.7、database 1.5.1、axios 0.34.0；源码与生成文件在上传时比较一致。

抽奖、PDF、压缩使用合成测试文件；证件照使用 [scikit-image 的 NASA astronaut 公开样图](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)，未上传用户私人照片。早期自动化批量调用曾超时，不能据此认定失败或成功；以上结论来自随后的云端任务读回、文件下载与模拟器画面。

## 证件照真实接入补充

- 用户在忽略的 .env.portrait 填写凭据后，先运行本地真实 BDA：providerRequestId=2e935c7b-1350-4f37-92dd-b3c01a6319cb，应用 requestId=a56da1b5-6f9e-4d93-9d91-7fe143bbd83f。确认分割结果有透明背景和不透明前景，再输出一寸蓝底 JPEG。
- scripts/configure-portrait.ps1 -Apply 已向既有 lightToolbox 合并三项配置并读回；白名单、开发模式、维护密钥、运行角色和触发器保留。未修改函数业务代码或公开发布。
- 模拟器预置公开样图路径和文件处理勾选状态，点击真实「生成证件照」按钮。实际执行上传登记、私有云上传、人像分割、裁切换底和 wx.cloud.downloadFile；页面 resultPath 有有效本地路径、error 为空。
- 读回原生下载文件并解码，确认 295×413 / 300 DPI / 41,062 字节；文件 output/portrait-test-cloud.jpg，页面截图 output/wechat-portrait-result.jpg。本地测试摘要 output/portrait-local-validation.json。
- 测试没有验证真实手机相册选择、官方隐私同意弹窗或保存相册。页面预置仅用于处理链路测试，不宣称解决隐私审核问题。
- 配置脚本的隔离回归测试通过：只读检查、原配置保留、无密钥输出、重复执行无更新、空凭据在访问云端前拒绝。CloudBase CLI 无角色策略查询权限（requestId 3fd79c70-e969-49f1-927e-0a63fe082f6e），实际接入使用独立 BDA 凭据，未改共享角色。

## 修复的根因

1. npm 祖先覆盖规则让嵌套 axios override 不生效。干净目录对照后改为平级 override，并使用已修复 Lodash 风险的官方 database 1.5.1；没有修改 node_modules 隐藏审计。
2. Node SDK 的 set/update 直接接收文档，原代码误用客户端 `{data:...}` 包装。现已修正，增加真实 SDK 序列化断言，并经真实数据库读写验证。
3. 暖实例的 WX context 可能残留，导致「Timer 且无 OPENID」条件错误拒绝维护。现用仅服务端密钥验证 Message，不接受客户端伪造；维护失败向平台抛错。
4. 下载改为原生私有云存储，减少域名配置；明确区分业务有效期和底层文件实际删除时刻。
5. 清理需处理从未完成的上传及删除后响应丢失：只将 SDK 明确定义的 -503003（文件不存在）视为已删除；权限、其他状态和不完整响应继续失败并保留任务，增加状态码日志和回归测试。
6. 增加 verification 模式，使白名单可在公开收费前完成真实支付验收。

## 待外部条件和真机验收

- 用户确认虚拟支付、Apple IAP 开通及两项商品正式价格发布；现网凭据和原生推送配置已读回，现为 production。Android 单次卡及 iPhone 月卡实际付款、到账和发货已核实；尚未实际退款或公开发布。
- 后续仍须验收实际原生消息到达、完整真机工具扣次、月卡续期和 iOS 单次卡；真实退款本版按用户决定暂缓。未将签名测试或已验证付款等同于全部场景验收。
- 证件照需要包含其实际用途的后台隐私指引生效，以及更多真实照片、手机保存相册的验收。
- Android/iOS 手机选文件、相册权限拒绝、PDF 打开/转发和大文件行为需要扫码验收。
- 云服务生产额度、预算和错误告警尚需确认，不能以开发调用成功推断长期免费。

## 图文转盘改版验收

- 已按用户纠正替换名单抽奖：配置 2–8 个图片加文字选项，可增删/排序，默认等概率，也可设整数权重。本机保存配置与图片，服务端仅接收文字、编号和权重。
- 在原生模拟器点击真实抽奖按钮，经开发云函数返回并展示结果。两轮等概率任务见上表；自定义权重 3:1:1:1:1:1 的真实任务 1c0e5233-8db0-453f-ba9c-922002298cf1，winnerIndex=0、probability=0.375，累计旋转 4680° 后第一项与指针对齐。服务端返回并非概率统计抽样证明；准确分配另由遍历全部整数票的测试验证。
- 模拟器以 chooseMedia mock 提供本项目 Lucide 测试配图，实际运行图片读取、copyFile 到 USER_DATA_PATH/light-wheel、保存配置、画布渲染；随后立即恢复 chooseMedia。退出重进读回图片路径、权重和最近结果一致。没有用该测试证明真实图库准入。
- 测试覆盖 2–8 扇区连续多轮落点、图片/文字必填、图片路径不进入请求、网络中断后重进沿用 jobId、防重复点击、返回内容不一致不动画、本机保存失败不发请求、只清理本工具已无引用图片。48 项全通过；88 个源代码/配置、6 页原生编译通过。
- 浏览器评审 UI 同步更换为转盘，共用原生纯函数规则；在临时本地服务 8878 验证配置、真实 HTTP 抽奖和中奖显示，随后关闭测试服务。
- 函数以 code update 更新；部署后只读配置核对通过，人像分割凭据、测试白名单和维护配置仍匹配，环境保持 development。没有提交审核或公开发布。
- 截图：output/wheel-editor.jpg、wheel-weighted-editor.jpg、wheel-cloud-result.jpg、wheel-final.jpg。新预览二维码：output/LIGHT-wheel-preview.jpg，入口 pages/wheel/index。手机动画流畅度、真实图库与隐私准入仍待真机验收。

## 虚拟支付接入与白名单验收准备

- 用户确认 Apple IAP 已开通，两项道具已发布：single=dragontoolbox02 / 100 分，month=dragontoolbox01 / 990 分，关联关系自定义。`scripts/configure-payment.ps1 -Apply` 合并商品 ID 并读回，原配置保留。其隔离 PowerShell 测试已覆盖缺失商品、无密钥输出、原配置保留、生产模式拒绝、显式验收模式和重复执行。
- 云端新增原生事件处理；全局订阅最初为空。用户在微信开发者工具确认后，任务 `confirmation_cloud_manage_msg_push_5d2231f1-965b-4b74-a092-95bb7f8f7fe8` 返回 success。全局读回 version=2 / enable=true / pushMode=cloudfunction，发货和退款两项事件均绑定本环境 lightToolbox；没有覆盖其他订阅。
- 原生事件只触发权威查单，不信任客户端可伪造的消息字段或暖实例 WX context。新增测试验证伪造支付/退款、不一致金额/平台单号、已退款订单不重发、重复通知幂等、主动发货失败保留重试。退款在数据库事务内复核最新订单，避免查单前后的并发变化破坏核对。
- `-EnableVerification -Apply` 只改变 LIGHT_MODE，读回 verification、iosEnabled=true、商品完整、其余环境变量/触发器/运行配置均保留；没有设置 LIGHT_PAYMENT_VERIFIED。客户端也已更新 verification。最后一次代码部署后只读核对 changedKeys=[]，函数 Active。
- 真实模拟器 `wx.login` → 云函数 jscode2session → 单次订单签名成功，orderId=`REDACTED_SIMULATOR_ORDER`，requestId=`da361c7f-2392-41b9-b8c7-90b9c92a5cae`。核对 env=0、productId=dragontoolbox02、quantity=1、price=100，两项签名均为 64 位；没有调用 requestVirtualPayment，没有扣款或发权益。
- 因测试仅生成本地业务订单，微信 query_order 返回官方错误 268490002「数据不存在」（requestId=`82a4a8a6-24e5-4231-bfe5-2eadffbeee15`）。新增明确未注册状态：仅 created 且无平台单号可记录该状态、原错误码、last_checked 和 warning；已付款单缺失及网络/签名等其他错误继续失败。真实云端复测返回 status=created（requestId=`b078b09a-7934-40b2-91a7-82c40f276f23`），profile credits=0 / isMember=false，保留该未支付测试记录供排查。
- 真实云端拒绝错误收件人的事件，ErrCode=1 / RECIPIENT_MISMATCH（requestId=`1c759643-bf42-4b63-b511-1f8fe6df5c0a`）。此为拒绝测试，不代表已收到微信实际付款通知。
- 最新检查：60 项 Node 测试通过；92 个源代码/配置文件、6 页 WXML/WXSS 编译通过；136 个可入库文件扫描 7 项本机敏感配置值，0 命中。没有更改依赖，沿用之前独立审计证据。
- 原生会员页 local=false、可见 0 次及两项真实套餐；截图 `output/wechat-payment-member.jpg`。官方预览生成成功，包体 174185 字节，入口 pages/member/index，二维码 `output/LIGHT-payment-preview.jpg`（470×470 JPEG）。这是开发预览，没有提交小程序审核或公开发布。
- **本节是付款前的准备证据**。随后用户已真实购买，结果与修复见下节；月卡续期、退款撤权、iOS 真机和隐私准入仍待验收。

## 首笔真实付款与确认发货签名修复

- 用户提供 Android 手机 2026-10-11 22:04:49 截图：错误 268490002「签名字段[pay_sig]为空」，应用 requestId=`3b11d26e-c272-4298-a7c7-fde048eab0ae`，平台 rid=`6acb977e-63dacd21-5b3db366`。修复前只读查账户确认订单 `REDACTED_ANDROID_FIRST_ORDER` 已 paid，100 分，paid_at=1791727482000，账户已有 1 次；因此没有让用户再次付款。
- 根因是 `WeChat.deliver` 显式传 `signed=false`，错误把单页没有列出 pay_sig 当作免签。所有 XPay 服务端请求现在统一强制签名，`query` / `deliver` 都按真实 URI 和实际发送的 JSON 字节计算 HMAC，删除免签选项。可选本地后端也使用同一修复。
- 先加入回归测试复现：发货 URL 缺失签名、原生回调经过实际 HTTP 适配器时失败；另证实旧逻辑只凭 268490002 会吞掉查询签名错误。修复后 63 项全部通过，92 个源/配置和 6 页原生编译通过。结果 `output/payment-signature-tests.log`；失败前证据 `output/payment-signature-regression-before.log` 与 `output/payment-error-classification-before.log`。
- 新增 `wechat.xpay.started/completed/failed` 日志，包含业务 requestId、orderId、operation、env、平台错误码/rid；权益确认与发货确认分段可追溯，不记录 token、签名、AppKey、OpenID、请求正文或完整 URL。只在 providerMessage 明确为「数据不存在」时保留未注册状态，其他复用错误码一律报错。
- 仅以 code update 部署 lightToolbox；函数 Active，配置脚本只读核对 verification / iOS=true / changedKeys=[]，未更改凭据、商品、订阅或公开权限。
- 修复后对原付款订单执行同步成功，requestId=`c7afa145-d851-4a95-826f-183437e18d7d`。再次读取账户仍为 1 次，没有重复发权益。官方数据库只读投影确认该订单 status=paid、delivered=true、platform_state=found，数据库 requestId=`5abb2bff-d881-47c0-b9b6-68f69270626a`；回执 `output/payment-delivery-readback.json`。没有新建或支付第二笔订单。
- 官方 CLI 日志查询返回空列表，未取得此次原生通知到达的独立日志证据，不能把订阅启用与订单到账当作已验证通知到达。首笔实付、查单、到账和发货确认已核实；后续原生通知、退款、月卡和 iOS 仍待独立验收。

## 运行时价格配置（2026-10-11）

- 用户把微信后台月卡改为 ¥1.1 后，指出每次改价不应改代码。分支 feat/light-price-config 移除服务端及原生/浏览器页面的写死价格，以 LIGHT_PRICE_SINGLE_FEN / LIGHT_PRICE_MONTH_FEN 为应用唯一来源，分别配置 100 / 110 分；没有自动拉取微信后台价格。操作见 PRICING.md。
- 70 项 Node 测试通过，日志 output/pricing-tests.log；94 个源代码/配置文件和 6 页原生 WXML/WXSS 编译通过。新增测试覆盖缺失/非法价格不降级、旧报价与伪造报价拒绝、云端价格与支付签名一致、两种存储的历史金额快照与 30 天权益、改价后退款、页面重载清除旧确认、价格读取失败禁止购买。
- 隔离 PowerShell 测试 tests/configure-prices.test.ps1 覆盖只读预检查、只合并两个字段、保留支付密钥/白名单/模式、重复执行不写、非法金额不访问云端、读回不一致失败及输出不泄密。使用模拟 CLI，不触碰真实云配置。
- scripts/configure-prices.ps1 -SingleFen 100 -MonthFen 110 -Apply 已应用；真实读回原配置/运行参数/触发器保留，之后代码更新只部署 lightToolbox。等待 Active 后预检查 changedKeys=[]，mode=verification，未设置 LIGHT_PAYMENT_VERIFIED。
- 官方模拟器通过 wx.cloud.callFunction 调用真实 /api/config 返回 single.price=100、month.price=110；用 month expectedPrice=990 真实调用 /api/orders 得到 PRICE_CHANGED。调用前后订单数均为 2，没有新建或支付测试订单、没有使用工具或模拟到账。
- 原生会员页 prices.month.label=1.1、daily=0.04、error 为空；首页返回同样价格且 local=false。真实页面截图 output/wechat-pricing-member.jpg。旧已付款单仍为 100 分 / paid，未受调价影响。当前账户显示 0 次；记录中已有 22:15 的成功压缩任务，本次调价没有运行该工具。
- 官方预览生成成功：output/LIGHT-pricing-preview.jpg（47026 字节），入口 pages/member/index。首次迁移需重新扫码使用这个版本；以后仅调整云端配置无需重传代码。月卡实际付款、iOS 和退款仍由真机验收，本次未调用 requestVirtualPayment。

## 用户视角原生体验优化（2026-10-11）

- 分支 feat/light-ux-review；修改原生首页、工具、转盘、记录及会员页交互。购买往返保留本次会话表单；未知结果保留原任务；成功处理与下载重试分开，避免重复处理；具体问题和修改见 [UX_REVIEW.md](UX_REVIEW.md)。
- 最新 `npm test` 82 项通过；`npm run check` 检查 98 个源代码/配置文件，6 页原生 WXML/WXSS 编译通过。日志位于 output/ux-review/tests.log 与 check.log。
- 模拟器真实云端压缩、PDF、证件照与转盘均成功，任务编号、结果及截图见体验报告；没有改后端、部署云函数或改变付款模式。本轮读取账户确认月卡已生效，但没有发起新购买或进行退款验收。
- 原生往返购买页后文件、质量55和勾选状态恢复；PDF通过可见按钮上移核实 A/B→B/A；转盘取消编辑后保留最近结果。图片选择采用专门测试素材注入，不能代替真实手机的隐私、选择器与保存相册验收。
- 官方首页预览生成成功：output/LIGHT-ux-preview.jpg，46601 字节；完整回执 output/ux-review/preview-receipt.json。本轮没有提交审核或公开发布。

## 剪贴板声明缺失定位（2026-10-11 23:16 真机反馈）

- 对已有任务 `5e81ec01-b466-4439-921c-aecd8e1fc8b5` 调用原生 copyResult，未经 mock 复现 `setClipboardData:fail api scope is not declared in the privacy agreement` / errno112。操作前后原任务和本机保存结果不变，pending=false；未发起新抽奖或支付。
- 原提示把复制与抽奖混为一般功能不可用；现在明确显示“暂时无法复制，本轮结果已保留，无需重新抽奖”，并增加 operation/jobId/orderId 日志，不记录复制正文。使用记录与订单复制也保留对应诊断上下文。
- 新增回归先复现提示分类失败，再验证复制失败不触发新任务、保留结果及日志关联。84 项测试通过，98 个源代码/配置文件、6 页原生编译通过。日志 output/clipboard-tests.log、clipboard-check.log，真实错误回执 clipboard-native-errors.json，前后截图 clipboard-before.jpg / clipboard-after.jpg。
- docs/PRIVACY_SETUP.md 补齐剪切板用途和四个复制入口。Chrome 请求头策略加载失败，未修改后台声明；后台补充、提交、生效及真机复制成功仍待完成。本次不是复制能力已恢复的验收。
- 官方新开发预览 output/LIGHT-clipboard-preview.jpg（47251 字节），入口 pages/wheel/index；回执 output/clipboard-preview-receipt.json。没有提交审核或公开发布；后台声明生效也适用于保留相同复制接口的旧预览版本。

## 按用户要求关闭抽奖结果复制

- 移除原生转盘结果卡片的复制按钮及方法；使用记录“查看结果”只展示内容并提供关闭按钮，不调用剪贴板。浏览器评审同步移除入口和执行分支。保留订单号与排查信息复制，更新当前隐私说明和 AGENTS.md。
- 删除已下线行为对应的测试，调整剩余剪贴板错误日志测试；83 项测试通过，98 个源代码/配置文件及 6 页原生编译通过。日志 output/remove-result-copy-tests.log、remove-result-copy-check.log。
- 原生模拟器打开已有抽奖结果，确认 hasResult=true、hasCopyHandler=false，任务编号不变；使用记录弹窗实际显示结果和唯一“关闭”按钮。截图 output/wheel-without-copy.jpg、record-result-without-copy.jpg。未发起新抽奖或付款。
- 新开发预览 output/LIGHT-no-copy-preview.jpg，入口 pages/wheel/index；回执 output/no-copy-preview-receipt.json。手机需重新扫码加载此版本，旧预览仍包含旧按钮。

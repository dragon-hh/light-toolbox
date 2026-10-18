# LIGHT 的工具箱

## 工作原则
1. Fail fast：不吞错、不以假数据或静默降级掩盖失败。
2. 修根因；关键链路保留 requestId、orderId、jobId 和结构化日志。绝不记录密钥、会话、照片正文或抽奖名单。
3. 技术栈和产品方向改变时，同步更新本文件。
4. 大规模重构、实验性更改先切新分支。初始开发分支为 feat/light-toolbox。
5. 用户界面只展示有助于当前操作、判断或处理问题的信息；已完成的确认不持续占据工具操作区。说明与管理入口集中放在合适页面，避免重复状态提示。
6. 公开 GitHub 仓库只提交源码、测试、非敏感资源与文档；环境密钥、数据库、运行日志、测试截图和本机配置不入库。文档中的真实订单号与受邀账号使用脱敏标识，原始回执留在被忽略的 output/ 目录。

## 产品与价格
- 微信原生小程序：证件照、幸运转盘、PDF 合并、图像压缩。
- 正式定价为所有平台统一单次使用权 ¥1、月卡 ¥9.9 / 30 天，手动续费；2026-10-11 曾临时以 ¥1.1 测试月卡。2026-10-12 用户确认微信道具已改回正式价并发布，云端已同步 100 / 990 分并通过原生运行时读回，历史测试订单和权益保留。
- 价格已配置化（分支 feat/light-price-config）：唯一应用价格来源为服务端 LIGHT_PRICE_SINGLE_FEN / LIGHT_PRICE_MONTH_FEN（整数分，无代码兜底）；/api/config 同时驱动页面、按钮和签名，下单验证 expectedPrice，旧报价或缺报价明确拒绝并要求重新确认。订单存金额快照，调价不改历史查单/退款金额和权益时长。微信已发布道具价与云端配置仍须同步维护，未实现微信后台价格自动拉取。用 scripts/configure-prices.ps1 合并并读回，仅更新这两个变量，不改模式、密钥、白名单、订阅或触发器；详见 docs/PRICING.md。一次迁移新预览后，后续改价无需改代码或重传小程序。
- 每次成功处理消耗一个次数；PDF 一组合并算一次，压缩一张图算一次，抽取一轮算一次。月卡覆盖四项工具。失败释放预留次数。
- 抽奖已按用户纠正改为图文转盘（2026-10-11，分支 feat/light-prize-wheel）：先配置 2–8 项，每项必须有图片和 1–40 字描述，可排序/删除；默认等概率，也可设置 1–100 整数权重。扇区等大，概率明确展示。每轮抽取一项，后续轮次允许重复。仅提供日常选择/活动辅助，不提供奖品、兑奖或现金奖池。
- 转盘专页 pages/wheel/index；历史 tool?id=lottery 入口重定向。crypto.randomInt 在服务端按整数权重决定 winnerIndex/id，客户端只将动画停到该项；动画不是随机源。接口使用 entries/title，结果 version=2 并保留 winners 字段以兼容记录展示；旧名单输入不再支持。
- 用户要求关闭“复制结果”（2026-10-11）：转盘结果卡片及使用记录中的抽奖弹窗只展示结果，不再调用剪贴板；浏览器评审同步移除入口。订单号和任务排查信息的复制保留。
- 原生工具处理同意（2026-10-12）：四款工具共用 utils/processing-consent.js，本机键 light.processingConsent 仅存说明版本与确认时间。用户主动确认一次后，跨工具、处理下一份文件和重启均记住；不从旧页面勾选状态推断已同意。文件与隐私页可撤回，处理前重读记录，存储读写失败明确阻断并记录日志；不得使用内存兜底。处理目的、第三方接收者或保留规则变更时同步更新 VERSION，重新取得确认。付款说明仍按每笔订单确认；微信隐私授权/相册权限由平台独立管理，不能用此本机记录绕过。
- 处理同意的显示规则（2026-10-12）：工具页仅在尚未同意时显示确认区；同意后整块消失，不显示“已同意”或常驻说明链接。查看与撤回入口保留在“我的 → 文件与隐私”。纯展示调整不改同意版本，不要求已确认用户重新勾选。
- 转盘配置和图片只保存在当前设备：light.wheel.v1 + USER_DATA_PATH/light-wheel，图片不上传；抽奖只提交选项编号/描述/权重和转盘名称。提交前持久化 pending jobId，网络不确定时复用原任务；响应核对编号和索引，收到成功结果先保存再动画，重进可恢复；禁止清掉未知状态后自动重抽。配置替换时仅清理本工具不再引用的图片。浏览器评审使用相同纯函数规则，单独存入本地浏览器。
- 证件照仅做背景替换、标准像素裁切；不承诺特定机构审核通过，不修改五官。

## 代码事实来源
- miniprogram/：WXML / WXSS / CommonJS；无前端 npm 构建。配置在 config.js，已验证基础库 3.17.3。
- 用户体验优化（2026-10-11，分支 feat/light-ux-review）：普通工具以 utils/tool-session.js 在本次应用会话内保存文件临时路径、参数、任务编号和结果，支持切到购买页后返回；不持久化照片或表单，不承诺退出/重启恢复。处理同意已改为上述独立版本记录。未知请求结果锁定输入并沿用 jobId；成功结果与重新处理分开，预览下载失败只重试下载。转盘仍使用自己的持久化机制。记录页提供直接保存、有效期与排查信息复制，月卡显示畅用及明确续期入口。验证边界见 docs/UX_REVIEW.md。
- 会员页调整（2026-10-12）：原生“我的”页对生效月卡以权益、到期时间、继续使用工具为主；已有单次次数单独显示，明确月卡期间不消耗。单次购买不向生效月卡展示；续期价格、顺延后的到期时间及购买说明需主动展开，关闭/重新进入或价格/权益变化会清除购买确认。成功购买收起续期，未确认支付会展开订单供核对；历史订单默认折叠，不将未确认订单擅自标为未付款。非会员保留按次/月卡购买选择。价格与计费规则不变。
- 原生信息精简（2026-10-12，用户已批准 16 项，分支 feat/light-ui-simplification）：首页只保留一组品牌文案与工具功能说明，真实月卡用户不显示套餐广告；工具页去掉重复页头与月卡计费提示，按次用户仍能看到余额及消耗。零次余额在月卡概览隐藏；等概率转盘列表可折叠，自定义权重必须显示实际概率。订单号、任务排查信息和详细制作/隐私说明按需展开。components/error-notice 统一页面内错误，utils/api.reportError 保留结构化日志并分离主提示和诊断编号，不得为精简吞错或同时重复弹窗。压缩格式由本机容器元数据提示（utils/image-format.js），不能从后缀猜透明通道；最终未缩小则保留原文件及提示。价格、处理流程和处理同意版本不变，详见 docs/UI_SIMPLIFICATION.md。
- 部署方向（2026-10-11）：已部署到已有微信云开发环境 cloud1-6gjewz7jf1fbf260，无需自购服务器或域名。cloud/ 为云端源代码；cloudfunctions/lightToolbox 由 npm run build:cloud 生成；Nodejs20.19 + CloudBase NoSQL + PRIVATE 云存储。分支 feat/light-cloudbase。四项工具均已有原生模拟器真实云端处理证据；选择器隐私准入与手机验收仍待完成。
- server/：Node.js >=24、Express、内置 SQLite、Sharp、pdf-lib，保留本地体验和对照测试；原持久化容器部署只是可选方案。
- Sharp 至少 0.35.5；腾讯 SDK common 的 uuid 暂覆盖为 11.1.1，修复上游旧版依赖漏洞。SDK 仅使用兼容的 uuid.v4，升级上游时复查 override。
- preview/：共享服务端 API 的浏览器评审界面，不是微信模拟器。local 模式不提供假支付、假会员。
- 服务端金额统一用整数分；wx.requestVirtualPayment 道具直购，现网 env=0。密钥只从环境读。
- 支付接入（2026-10-11，分支 feat/light-payment-push）：用户确认商品已发布，single=dragontoolbox02 / 100 分，month=dragontoolbox01 / 990 分（曾以 110 分测试），关联关系自定义；权益由服务端 SKU 映射。现网凭据、商品 ID 和 XPAY_IOS_ENABLED=true 已合并至云端并读回。Android 真机单次卡及 iPhone 月卡首次付款、到账与确认发货已有证据；实际原生通知独立到达、提前续期等仍未完整验收，真实退款本版按用户决定暂缓，不设置 LIGHT_PAYMENT_VERIFIED。
- 云端选用微信原生云函数消息推送，无需 HTTP 回调域名。当前 Nightly CLI 已支持 cloud_query_msg_push/cloud_manage_msg_push，以实际 --help 为准。原生回调代码已部署；用户已在开发者工具确认，全球配置读回 version=2 / enable=true / cloudfunction，只有 xpay_goods_deliver_notify 和 xpay_refund_notify 两项，均指向 lightToolbox。任务完成信息在 output/payment-push-pending.json。
- 以微信服务端查单确认付款。原生推送只作为不可信的查单触发信号，不以 WX context/SOURCE 作为鉴权；校验收件人、订单归属、道具金额和测试白名单后查单，确认付款再主动 notify_provide_goods，失败保留待确认发货状态。退款必须查原支付单的 left_fee，并在事务内再核对平台订单与累计退款额。可选 HTTP 推送另须验签解密。本地 SQLite 唯一约束；云端以用户 revision、订单文档、平台单号派生的 receipt 文档做事务幂等。云端事务内不使用 where，也不调用外部接口。
- 仅可选本地后端使用单实例 SQLite WAL + 持久化磁盘；当前云端使用共享 NoSQL 事务。Node SDK 文档 set/update 接收直接对象，不能使用客户端 SDK 的 {data:...} 包装。
- 本地原始文件只存在请求内存。云端原始文件临时保存在私有存储，成功处理即删；中断上传及失败任务最长保留 1 小时，加正常情况下最多一个 5 分钟清理周期。所有上传前先登记完整 fileID。结果下载先鉴权/检查期限，再通过 wx.cloud.downloadFile；PRIVATE 存储允许创建者和管理员读写，不能描述成结果仅服务端可读。到期后拒绝业务下载，实际删除前拥有者仍可直接通过 SDK 访问。
- 云环境里已有 10 个旧函数及 10 个旧集合。只新增 lightToolbox、light_* 集合和 light-toolbox/ 文件目录；不得修改旧 login/wxpayFunctions，也不得整体覆盖存储规则。修改规则必须保留旧目录权限。
- 云函数默认 LIGHT_MODE=closed；development 为白名单免费体验，verification 为白名单真实付款验收，production 为公开付费阶段，工具处理按真实权益计费。2026-10-12 用户明确本版暂缓真实退款验收并要求正式运行，生产门禁改为 LIGHT_PRODUCTION_ENABLED=true，表示运营授权；不得因此设置 LIGHT_PAYMENT_VERIFIED 或把未验收事项标成通过。客户端与云端现为 production / cloud，云函数 Active，原生真实调用已确认 100 / 990 分、身份识别接口关闭及原有权益不变。这里只完成运行配置，未提交审核或公开发布；详见 docs/PRODUCTION.md。scripts/configure-production.ps1 仅合并模式、运行开关及正式价格并完整读回；scripts/configure-payment.ps1 仍拒绝改写 production。
- 测试账号识别（2026-10-12）：独立入口 pages/test-identity/index，经本人点击后调用 GET /api/identity；closed/development/verification 只返回微信上下文确认的调用者本人 OpenID，校验 AppID 与身份，不信任请求参数，不写库、不自动加入白名单、不授予权益。生产模式关闭该接口，正式包不显示识别按钮。页面不接入常规导航，不持久化、不记录或主动复制 OpenID；测试者将识别页截图交给邀请人，再由管理员核对目标账号后追加云端白名单。二维码不是邀请码，转发不会自动获得权限。
- 最初模拟器只验证签名、不扣款；后续用户真实购买订单 REDACTED_ANDROID_FIRST_ORDER 已 paid / delivered=true，credits=1。曾因 notify_provide_goods 漏传 pay_sig 在到账后报错；现所有 XPay 服务请求强制按实际路径与原始 JSON 请求体签名，无 unsigned 开关，查单和发货记录 requestId/orderId/operation/平台 rid，不记录签名、密钥、OpenID 或请求完整 URL。
- 微信错误码 268490002 被多个错误复用，不能仅凭数字认定订单不存在。仅 query_order 明确返回「数据不存在」且 created / 无平台单号时记录 platform_state=not_registered、原错误码、last_checked 及 warning；绝不发权益。签名错误、已付款订单缺失、其他错误仍抛出，原生支付事件在查不到订单时也不成功应答。
- 维护触发器以仅服务端存放的 256 位 LIGHT_MAINTENANCE_TOKEN 鉴权，CustomArgument 与环境变量一致；不能依赖 OPENID 缺失判断 Timer，因为暖实例可能残留微信上下文。用 scripts/configure-maintenance.ps1 配置/验证，失败抛出使平台标记失败；密钥不得写入代码包。每 5 分钟清理和对账。
- 云函数独立锁文件固定官方 Node SDK 3.18.7、database 1.5.1；axios 使用平级 override 0.34.0。避免 wx-server-sdk 祖先 override 抵消嵌套 axios override。根项目与云函数包都必须独立审计；2026-10-11 均已为 0 漏洞。
- 日志和订单供排查；不得以客户端 success 回调直接发权益。
- iPhone 新测试账号月卡付款（2026-10-12）：用户报告成功后，官方云数据库读回订单 REDACTED_IOS_MONTH_ORDER 为 month / 110 分 / paid / delivered=true，支付时间北京时间 22:24:49；按全部订单计算月卡至 2026-11-11 22:24:49。用户明确确认手机为 iPhone，故 iOS 月卡首次购买、权益到账与发货确认已有真机证据。未手工赋权；iOS 单次卡、真实退款、提前续期和退出支付后的通知到账仍待分别验收，不据此设置 LIGHT_PAYMENT_VERIFIED。证据见 docs/TEST_ACCESS.md。
- 证件照接入（2026-10-11）：用户已开通腾讯云人像分割并在忽略的 .env.portrait 填入凭据；scripts/configure-portrait.ps1 已合并到 lightToolbox 并读回确认原配置保留。真实 BDA、本地一寸蓝底输出、原生页面云任务及 wx.cloud.downloadFile 均成功，云任务 f26e40c9-954a-4501-8d0e-949689becd25，295×413 / 300 DPI。测试用 NASA 公开样图，页面输入和勾选状态预置，不代表手机选图/隐私授权通过。禁止输出密钥或改动共享 TCB_QcsRole；当前 CLI 无角色策略查询权限，与使用独立 BDA 凭据的调用成功不矛盾。

## 验证
2026-10-11 23:16 真机报告转盘结果复制失败；官方模拟器复现 setClipboardData / errno112 / api scope is not declared in the privacy agreement。随后按用户要求移除了抽奖结果复制功能。保留的复制订单号、排查信息仍须声明“剪切板”（仅写入，不读取已有内容）；后台提交及生效仍待完成，不能宣称剩余复制功能已恢复。详见 docs/PRIVACY_SETUP.md。
`npm test` 验证签名、消息解密、计费事务、退款、真实文件处理和 HTTP 权限边界。
`npm run check` 验证 JS/JSON、路由、资源、占位配置和编译器可用时的 WXML/WXSS。
检查必须只读，编译器输出到 stdout，禁止把源文件当作输出路径。检查脚本会逐文件比对执行前后的内容。
微信 style:v2 对普通 button 有固定宽度及自动外边距；自定义按钮需要按 app.wxss 的同等选择器重置，组件尺寸用 button.class 覆盖。
本地启动 `npm run dev`。真实支付、微信登录、腾讯抠图、真机体验必须用真实配置验证，不能以本地通过代替。
真机隐私准入是独立验收项：后台生效的用户隐私保护指引须覆盖 chooseMedia、相机、chooseMessageFile 和保存相册等实际使用能力。`__usePrivacyCheck__` 或 requirePrivacyAuthorize 不能替代后台声明；不得降低基础库、禁用隐私校验或换接口绕过。选择器 mock / 预置素材只验证处理链路，不证明真机选图可用。2026-10-11 用户实测 chooseMedia 被隐私声明拦截，13:00 模拟器仍报 errno 112。用户随后提供指引审核不通过通知，选中照片或视频项的原文为「图片压缩、证件照制作」，驳回原因为说明内容不符合接口使用场景。已按当前云端压缩流程修订填写建议；后台重新提交、审核生效及手机复测均待完成，不能标记已修复。配置说明见 docs/PRIVACY_SETUP.md。

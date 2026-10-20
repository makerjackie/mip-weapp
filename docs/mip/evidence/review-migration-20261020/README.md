# mip-review迁入miptest

用户指出10月19日晚六枚icon与对应原型不在miptest中，明确要求合并旧mip-review站。

- 新入口：[10月19日六角色图标、原型与界面对照](https://miptest.01mvp.com/updates/2026-10-19/)；原报告：[完整快照](https://miptest.01mvp.com/legacy/20261019/)。首页按原报告日期列20日、19日两条记录，不把迁移时间冒充原报告日期或旧站精确首次发布时间。
- 原站36个公开文件全部通过真实HTTPS回读，与既有公开构建逐字节一致后存入`docs/mip/acceptance-site/legacy/20261019/`。所有原HTML、19张界面对照/实拍、六标签预览、六图标、六标签、原始SVG、ZIP与robots保留；archive.json逐文件校验，后续构建拒绝改写历史字节。
- 六角色图标摘要及原始Figma SVG摘要与既有导出清单一致；六标签PNG是原SVG渲染预览，未当作新小程序截图或Figma原始PNG。原型链接4197:38017保留。下载包ZIP完整性检查通过。
- 原报告的mip-dev/Figma四列、数据差异、同状态重拍豁免和真机待验全部保留。不把旧原型当新原型，不声称本次重新实现业务或做了真机验收；本次没有小程序或云端业务部署。
- 源码f4a5a248已推送main。miptest部署286dd362完成，真实域名204文件字节一致，SVG图片MIME及HTML类型通过。1440×900和390×844：首页日期排序、六枚图标、原稿预览、全部20张历史图片解码、无溢出/pageerror通过；14个SVG/ZIP链接另在1440视口核对字节，手机未重复下载。见live-browser.json与https-summary.json。
- 旧站跳转只更新既有mip-review Pages项目，不删除项目、不改DNS。部署脚本先回读新站36个原文件并比对SHA，全部通过才发布。旧站部署ba5bc5bc完成；36个原路径均301到新站同名文件且字节匹配，手机真实浏览器旧`#role-icons`书签仍准确定位。见redirect-verification.json。
- 最终完整 `pnpm verify:all` 退出0：小程序1850、Web合同338、React262；专项8项、文档链接和diff检查通过。

本批为历史报告迁移，无新的视觉原型。界面来源与修改前后的原始历史四列完整保存在快照；本站新增入口与图库的真实桌面/手机图见同目录home和icons截图，不伪造旧网站的同状态对照。

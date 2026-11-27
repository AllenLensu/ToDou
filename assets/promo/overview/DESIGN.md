# ToDou 1.7 · 周六去拍日出

周六 05:15 出发，06:10 到海堤。电池什么时候充、路线从哪里走、照片回家后发给谁，都是这份清单里的事。全片为中文横屏，长 3 分 50 秒。MP4 内嵌 19 个可跳转的章节。

## 分镜

| 起点 | 画面 |
| --- | --- |
| 00:00 | 一张海堤照片和周六清晨的出发时间。 |
| 00:07 | 输入「周六早上五点一刻 去拍日出」，对照提取的标题和提醒时间。 |
| 00:19 | 逐行选择要建的任务和要采用的提醒，由三行草稿留下两项。 |
| 00:30 | 把 05:15 提醒与 06:10 截止分开，再补上优先级、集合点和路线。 |
| 00:41 | 子任务独立跟进。装包的三个检查项逐项勾选，备用电池有单独的提醒。 |
| 00:53 | 搜索备注和检查项里的词。将分类、标签、视图与搜索条件存为「周末摄影」。 |
| 01:06 | 今天含逾期事项。即将到来的七天按日计数，点日期可直接跳转。 |
| 01:20 | 把带时间、区分任务和检查项的日程复制给同行人。 |
| 01:29 | 比较固定日历与按完成日重复，选择改期范围，以及检查项的跟随或独立重复。 |
| 01:43 | 下次从本机模板新建，基准日期换成 12 月 5 日，核对任务和装电池的时间。 |
| 01:55 | 中文浅色清单切到英文深色，任务文字保留原文，六种空态插图也随主题显示。 |
| 02:04 | 手机实拍显示底部导航与今日任务，配合 PWA 图标快捷方式、局域网访问和桌面键盘操作。 |
| 02:13 | 依次展示网页开窗提醒、Windows 全局录入与托盘、Android 分享录入与锁屏操作。 |
| 02:28 | PWA 提前缓存，断网后把现场备注存回本机，重新联网后可以重试更新。 |
| 02:40 | 海堤上收工，展开父子项完成策略、编辑保存和误删撤销。 |
| 02:52 | 发照片的提醒先点「知道了」，再演示追提醒、免打扰、队列与自选推迟时间。 |
| 03:07 | 三端连接同一网盘目录，合并不同字段，核对冲突、同步间隔和待上传明细。 |
| 03:22 | 在历史中取回备注，从回收站找回任务，预览文件备份，并逐台确认整库恢复。 |
| 03:40 | 展开拍到的海堤全景，随钢琴尾声落版。 |

## 画面与声音

产品实拍来自 Web 1.7 正式构建。十张桌面截图由 ego lite 采集，手机窄屏截图使用 400 × 800 的浏览器设备视口。片中的时刻、任务和同行人均为演示内容。Windows 托盘示意和 Android 锁屏示例沿用项目素材。海堤和器材两张照片由 ImageGen 生成。其余功能以放大的界面局部和操作图解呈现。

摄影画面使用黑白色调，暖白纸面为 `#F7F6F1`，墨色为 `#101010`，红色 `#D71921` 标注动作和提醒。标题用霞鹜新晰黑与 Space Grotesk，数据用 Space Mono，片头时间用 Doto。四款字体均从项目本地加载。

音乐沿用项目的 C 大调钢琴独奏《晚饭之前》。录音所用钢琴采样为 Alexander Holm 录制、C. Yamauchi 团队重制的 Moonlight V6.2e。详见[原配乐、作者信息和采样授权](../source/DESIGN.md#画面与声音)。

## 重新导出

在仓库根目录准备 Node.js、Chromium、FFmpeg 和 FFprobe。HyperFrames 支持通过环境变量 `HYPERFRAMES_BROWSER_PATH`、`HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH` 指定可执行文件。

```powershell
npm install --prefix .cache/promo-tools hyperframes@0.9.61 gsap@3.14.2
node assets/promo/overview/prepare.mjs
.cache/promo-tools/node_modules/.bin/hyperframes.cmd render .cache/sunrise --fps 30 --quality high --workers 4 --output .cache/sunrise-picture.mp4
ffmpeg -y -i .cache/sunrise-picture.mp4 -i assets/promo/source/score.m4a -f ffmetadata -i .cache/sunrise/chapters.ffmeta -map 0:v:0 -map 1:a:0 -map_metadata 2 -map_chapters 2 -c copy -movflags +faststart assets/promo/ToDou.mp4
ffmpeg -y -ss 4 -i assets/promo/ToDou.mp4 -frames:v 1 -q:v 2 assets/promo/overview/cover.jpg
```

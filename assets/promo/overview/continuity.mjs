// The cuts and field reveals below use chapter-local seconds. Only this function
// is embedded in the player, so it resolves every target beneath its own clip.
function playContinuity(tl, el) {
  for (const part of el.querySelectorAll('[data-on]')) {
    const on = Number(part.dataset.on);
    const off = part.dataset.off;
    tl.fromTo(part, { autoAlpha: 0, y: 12 }, {
      autoAlpha: 1, y: 0, duration: .32, ease: 'power2.out', immediateRender: false
    }, on);
    if (off !== undefined) {
      tl.to(part, { autoAlpha: 0, y: -7, duration: .16, ease: 'power1.in' }, Number(off) - .16);
    }
  }
  for (const line of el.querySelectorAll('[data-rule]')) {
    tl.fromTo(line, { scaleX: 0 }, {
      scaleX: 1, duration: .58, transformOrigin: 'left center', ease: 'power2.out', immediateRender: false
    }, Number(line.dataset.rule));
  }
  for (const hand of el.querySelectorAll('[data-angles]')) {
    const turns = JSON.parse(hand.dataset.angles);
    tl.set(hand, { rotation: turns[0][1], transformOrigin: '50% 100%' }, 0);
    for (const [time, rotation] of turns.slice(1)) {
      tl.to(hand, { rotation, duration: .65, ease: 'power2.inOut' }, time);
    }
  }
}

function scene(chapter, heading, body, dark = false) {
  return `<div class="continuity-panel${dark ? ' ct-dark' : ''}">
    <div class="ct-header"><span class="ct-wordmark">ToDou</span><span>${chapter}</span></div>
    <h2 class="ct-heading">${heading}</h2>${body}</div>`;
}

function beat(on, off, html, classes = '') {
  const end = off === null ? '' : ` data-off="${off}"`;
  return `<div class="ct-beat ${classes}" data-on="${on}"${end}>${html}</div>`;
}

function meta(text) { return `<span class="ct-meta">${text}</span>`; }

function clockTicks() {
  return Array.from({ length: 60 }, (_, i) => {
    const tall = i % 5 === 0;
    return `<line x1="240" x2="240" y1="12" y2="${tall ? 40 : 23}" transform="rotate(${i * 6} 240 240)" stroke-width="${tall ? 4 : 2}"/>`;
  }).join('');
}

const signals = scene('REMINDERS', '照片发了吗？', `
  <div class="ct-alarm-grid">
    <div class="ct-dial">
      <svg viewBox="0 0 480 480" aria-hidden="true"><g fill="none" stroke="currentColor">${clockTicks()}</g></svg>
      <div class="ct-hand" data-angles='[[0,180],[3.8,270],[8,360],[11.5,360]]'></div>
      <div class="ct-dial-face">
        ${beat(.05, 3.9, '18:30')}${beat(3.9, 8.1, '18:45')}${beat(8.1, 11.55, '22:00')}${beat(11.55, null, '09:00')}
      </div>
    </div>
    <div class="ct-alarm-explain">
      ${beat(.1, 3.85, `${meta('提醒队列　01 / 02')}<h3>把照片发给同行人</h3><p>正在收相机，先点「知道了」。</p><div class="ct-rule" data-rule=".65"></div><div class="ct-note">下一条提醒接着出现。</div>`)}
      ${beat(3.85, 8.05, `${meta('追提醒间隔')}<h3>过 15 分钟，再提醒。</h3><p>这项任务可以单设间隔，<br>也可以沿用分类或全局设置。</p>`)}
      ${beat(8.05, 11.5, `${meta('免打扰时段')}<h3>夜里先安静。</h3><p>可选在免打扰结束后补发提醒。</p>`)}
      ${beat(11.5, null, `${meta('页内推迟')}<h3>明早 09:00</h3><p>也能指定自己的日期和时刻。</p>`)}
    </div>
  </div>`, true);

function device(label, time, off, content) {
  return beat(time, off, `${meta(label)}${content}`, 'ct-device-view');
}

const devices = scene('WEB / WINDOWS / ANDROID', '到点时，在哪儿收提醒？', `
  <div class="ct-device-grid">
    <div class="ct-device-index">
      ${['Web / PWA','Windows','Android'].map((name, i) => `<div><span class="ct-device-dot" data-on="${[.05,4.6,9.8][i]}"${i < 2 ? ` data-off="${[4.6,9.8][i]}"` : ''}></span>${name}</div>`).join('')}
    </div>
    <div class="ct-device-screen">
      ${device('浏览器 / 已安装的 PWA', .1, 4.6, `<div class="ct-web-inset"><img src="media/pwa-icon.png" alt="ToDou 应用图标"><strong>给相机电池充电</strong></div><p>允许系统通知，并保持页面或 PWA 窗口运行。</p>`)}
      ${device('全局快速录入', 4.6, 9.8, `<h3 class="ct-keychord">Ctrl + Alt + N</h3><p>关窗后留在托盘，闹钟式提醒可持续响铃。<br>在通知上完成，或推迟 10 分钟。</p><div class="ct-tray"><img src="media/windows-tray.png" alt="Windows 托盘菜单示意"></div>`)}
      ${device('ANDROID 锁屏通知示例', 9.8, null, `<img class="ct-android" src="media/android-lock.png" alt="Android 锁屏通知中的完成与推迟 15 分钟"><p>分享文字、链接给 ToDou，直接记成草稿。<br>锁屏可完成、推迟 15 分钟，或停止循环响铃。</p>`)}
    </div>
  </div>`);

const offline = scene('LOCAL SQLITE', '海堤上，没信号。', `
  <div class="ct-offline-grid">
    <div class="ct-offline-story">
      ${beat(.05, 3.8, `${meta('出门前　／　联网')}<h3>先打开一次。</h3><p>网页完成离线缓存后，<br>就能从原地址或 PWA 图标重开。</p>`)}
      ${beat(3.8, 8.1, `${meta('到达海堤　／　断网')}<h3>照样写进清单。</h3><p>任务、检查项和备注保存在本机 SQLite。<br>单机使用免注册。</p>`)}
      ${beat(8.1, null, `${meta('再次联网　／　更新')}<h3>旧版还能开。</h3><p>新版本下载失败时，<br>可继续使用已缓存的版本。</p>`)}
    </div>
    <div class="ct-record">
      <div class="ct-record-head"><span>ToDou</span><span>WEB / PWA</span></div>
      ${beat(.12, 3.8, `${meta('设置　／　离线启动')}<h3>已可离线打开</h3><div class="ct-cache-bars">${'<i></i>'.repeat(14)}</div><p>本机已有可用的离线版本。</p>`)}
      ${beat(3.8, 8.1, `${meta('周六去拍日出　／　备注')}<h3>东堤有风。</h3><p data-on="5.45">三脚架挂上相机包。</p><div class="ct-stamp" data-on="6.45">已保存到本机</div>`)}
      ${beat(8.1, null, `${meta('设置　／　离线启动')}<h3>更新下载失败</h3><p>离线版本仍可使用</p><div class="ct-stamp" data-on="9.25">重试离线缓存</div>`)}
    </div>
  </div>`, true);

const sync = scene('ONEDRIVE / WEBDAV', '回到家，同步清单。', `
  <div class="ct-sync-stage">
    ${beat(.05, 4.2, `<div class="ct-folder"><div class="ct-dir-icon" aria-hidden="true"></div><div>${meta('三端连接同一目录')}<h3>自己的网盘</h3><p>OneDrive 个人、工作或学校账号，或 WebDAV。</p></div></div>`,`ct-full`)}
    ${beat(4.2, 9.35, `<div class="ct-merge"><div class="ct-field-table"><div><span>WINDOWS　／　标题</span><b>周六去拍日出</b></div><div data-on="5.0"><span>ANDROID　／　备注</span><b>东堤有风，带三脚架。</b></div></div><div class="ct-merge-arrow" data-on="5.65">→</div><div class="ct-merged" data-on="5.9">${meta('同步后　／　同一项任务')}<h3>周六去拍日出</h3><p>东堤有风，带三脚架。</p></div></div><div class="ct-merge-caption" data-on="6.7">分别改动的字段可以合并。同一字段同刻出现分歧时，由你选。</div>`,`ct-full`)}
    ${beat(9.35, null, `<div class="ct-pending"><div>${meta('网盘同步　／　待办同步')}<h3>哪些改动还没传？</h3><p>打开「查看待上传明细」，<br>可按任务核对字段改动。</p></div><div class="ct-pending-sheet">${meta('周六去拍日出')}<div><span>任务</span><span>2 项字段改动</span></div></div></div><div class="ct-merge-caption" data-on="11.3">新连接默认每 5 分钟同步。也可选 1、15、30、60 分钟或手动。</div>`,`ct-full`)}
  </div>`);

// Crop the captured UI in its original 1548 × 988 coordinate system.
function screenCrop(file, label, x, y, width, height, scale) {
  return `<div class="ct-screen-crop" style="width:${width * scale}px;height:${height * scale}px" data-layout-allow-overflow><img src="stills/${file}.png" alt="${label}" style="width:${1548 * scale}px;left:${-x * scale}px;top:${-y * scale}px"></div>`;
}

const historyCrop = screenCrop('history', '恢复前比较：旧备注与当前备注', 675, 639, 711, 173, 1.22);
const fieldCrop = screenCrop('history', '取回此字段', 683, 769, 92, 32, 2.4);
const trashTitle = screenCrop('trash', '回收站里的改走旧码头路线', 140, 242, 150, 52, 2);
const trashActions = screenCrop('trash', '恢复和永久删除', 1244, 238, 150, 54, 2);

const safety = scene('HISTORY / BACKUP', '把清单找回来。', `
  <div class="ct-safe-stage">
    ${beat(.05, 4.15, `<div class="ct-rescue ct-capture-pair"><div>${meta('修改历史')}<h3>只取回旧备注。</h3><p>查看恢复差异后，标题、备注或链接都能单独取回。</p></div><div class="ct-proof">${historyCrop}<div class="ct-action-detail" data-on="1.35">${fieldCrop}</div></div></div>`, 'ct-full')}
    ${beat(4.15, 7.9, `<div class="ct-rescue ct-capture-pair"><div>${meta('回收站')}<h3>误删的任务还在。</h3><p>可以恢复到清单。确定不要时，再确认永久删除。</p></div><div class="ct-proof ct-trash-proof">${meta('回收站　／　1 项')}<div class="ct-trash-row">${trashTitle}<div data-on="4.95">${trashActions}</div></div></div></div>`, 'ct-full')}
    ${beat(7.9, 13.0, `<div class="ct-rescue"><div>${meta('数据与备份')}<h3>留一份独立备份。</h3><p>导出 .todou.json，导入前先预览。<br>每天也可自动备份到本机或 WebDAV。</p></div><div class="ct-retention"><div><span>本机自动副本</span><strong>03</strong></div><div data-on="8.8"><span>WebDAV 每台设备</span><strong>10</strong></div><small data-on="10.4">手动备份保留到主动删除。</small></div></div>`, 'ct-full')}
    ${beat(13, null, `<div class="ct-rescue"><div>${meta('跨设备整体恢复')}<h3>整份清单，逐台恢复。</h3><p>来源设备先发布恢复快照。<br>每台接收设备预览、确认，再替换。</p></div><div class="ct-restore-seq"><div><b>01</b>发布恢复快照</div><div data-on="13.9"><b>02</b>预览替换范围</div><div data-on="14.7"><b>03</b>保留本机副本，再恢复</div></div></div>`, 'ct-full')}
  </div>`);

export const continuity = [
  { id: 'signals', title: '追提醒与免打扰', seconds: 15, html: signals, animate: playContinuity },
  { id: 'devices', title: '三端收提醒', seconds: 15, html: devices, animate: playContinuity },
  { id: 'offline', title: '离线也能记', seconds: 12, html: offline, animate: playContinuity },
  { id: 'sync', title: '字段同步与待上传明细', seconds: 15, html: sync, animate: playContinuity },
  { id: 'safety', title: '历史、回收站与备份', seconds: 18, html: safety, animate: playContinuity },
];

export const continuityCSS = `
.continuity-panel { --cp-paper:#f7f6f1; --cp-ink:#121211; --cp-dim:#62615e; --cp-line:#a5a49d; --cp-red:#d71921; position:absolute; inset:0; color:var(--cp-ink); background:var(--cp-paper); font:40px/1.42 Grotesk,Xihei,sans-serif; overflow:hidden; }
.continuity-panel *, .continuity-panel *::before, .continuity-panel *::after { box-sizing:border-box }
.continuity-panel.ct-dark { --cp-dim:#b7b6af; --cp-line:#666560; color:var(--cp-paper); background:var(--cp-ink) }
.continuity-panel h2,.continuity-panel h3,.continuity-panel p { margin:0; font-weight:400 }
.ct-header { position:absolute; top:69px; left:96px; right:96px; height:65px; border-bottom:2px solid currentColor; display:flex; justify-content:space-between; align-items:flex-start; font:26px/1.15 Mono,Xihei,monospace; letter-spacing:1px }
.ct-wordmark { font:600 35px/.95 Grotesk,sans-serif; letter-spacing:-2px }
.continuity-panel .ct-heading { position:absolute; left:96px; top:180px; font:90px/1.2 Xihei,sans-serif; letter-spacing:-4px }
.continuity-panel h3 { font:64px/1.22 Grotesk,Xihei,sans-serif; letter-spacing:-2px }
.continuity-panel p { margin-top:26px; font:37px/1.56 Grotesk,Xihei,sans-serif }
.ct-meta, .ct-note, .ct-merge-caption { font:27px/1.5 Mono,Xihei,monospace; color:var(--cp-dim) }
.ct-meta { display:block; margin-bottom:27px; letter-spacing:.5px }
.ct-note { font-size:32px }
.ct-rule { height:2px; background:var(--cp-line); margin:32px 0 24px; }
.ct-beat { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:flex-start }
.continuity-panel [data-on] { opacity:0; visibility:hidden }
.ct-alarm-grid, .ct-device-grid, .ct-offline-grid { position:absolute; left:96px; right:96px; top:331px; bottom:97px; display:grid; align-items:center; }
.ct-alarm-grid { grid-template-columns:730px 1fr; gap:98px; }
.ct-dial { position:relative; width:568px; height:568px; margin-left:38px; }
.ct-dial svg { width:100%; height:100%; color:#a6a59e }
.ct-hand { position:absolute; width:6px; height:49%; top:1%; left:calc(50% - 3px); background:var(--cp-red); transform-origin:50% 100%; }
.ct-dial-face { position:absolute; inset:87px; border-radius:50%; background:var(--cp-ink); }
.ct-dial-face .ct-beat { align-items:center; font:740 112px/1 Doto,Mono,monospace; letter-spacing:-8px; }
.ct-alarm-explain { position:relative; align-self:stretch; }
.ct-device-grid { grid-template-columns:565px 1fr; gap:86px; }
.ct-device-index { align-self:center; }
.ct-device-index > div { display:flex; align-items:center; gap:26px; border-top:2px solid var(--cp-line); padding:28px 0; font:58px/1.1 Grotesk,sans-serif; letter-spacing:-2px; }
.ct-device-index > div:last-child { border-bottom:2px solid var(--cp-line) }
.ct-device-dot { display:inline-block; width:17px; height:17px; border-radius:50%; background:var(--cp-red); }
.ct-device-screen { position:relative; align-self:stretch; }
.ct-device-view .ct-meta { margin-bottom:22px }
.ct-device-view p { font-size:35px; margin-top:22px; }
.ct-web-inset { display:flex; align-items:center; gap:30px; border-block:2px solid var(--cp-line); padding:30px 0; width:100%; }
.ct-web-inset img { width:98px; height:98px; }
.ct-web-inset strong { font:53px/1.25 Xihei,sans-serif; }
.continuity-panel .ct-keychord { font:65px/1.2 Mono,monospace; letter-spacing:-3px; }
.ct-tray { width:480px; margin-top:22px; border:1px solid var(--cp-line); }
.ct-tray img,.ct-android { display:block; width:100%; }
.ct-android { width:645px; }
.ct-offline-grid { grid-template-columns:1fr 788px; gap:90px; }
.ct-offline-story { align-self:stretch; position:relative; }
.ct-offline-story p { font-size:35px; }
.ct-record { --cp-dim:#62615e; position:relative; min-height:520px; background:var(--cp-paper); color:var(--cp-ink); padding:38px 44px; }
.ct-record-head { display:flex; align-items:baseline; justify-content:space-between; border-bottom:2px solid var(--cp-ink); padding-bottom:17px; font:24px/1.2 Mono,monospace; }
.ct-record-head span:first-child { font:500 37px/1 Grotesk,sans-serif; letter-spacing:-2px; }
.ct-record .ct-beat { inset:104px 44px 34px; }
.ct-record h3 { font-size:60px; }
.ct-record p { font-size:32px; margin-top:18px; }
.ct-cache-bars { display:flex; gap:6px; margin-top:30px; }
.ct-cache-bars i { width:27px; height:25px; background:var(--cp-ink); }
.ct-stamp { padding:7px 19px; border:2px solid currentColor; margin-top:24px; font:27px/1.35 Mono,Xihei,monospace; }
.ct-sync-stage,.ct-safe-stage { position:absolute; top:333px; left:96px; right:96px; bottom:108px; }
.ct-full { align-items:stretch; }
.ct-folder { display:grid; align-items:center; gap:98px; grid-template-columns:420px 1fr; }
.ct-dir-icon { position:relative; width:355px; height:218px; margin:50px 0 0 26px; border:7px solid currentColor; border-radius:0 16px 16px 16px; }
.ct-dir-icon::before { content:''; position:absolute; bottom:100%; left:-7px; width:140px; height:45px; border:7px solid currentColor; border-bottom-color:var(--cp-paper); border-radius:13px 24px 0 0; }
.ct-dir-icon::after { content:''; position:absolute; bottom:25px; right:25px; width:20px; height:20px; border-radius:50%; background:var(--cp-red); }
.ct-folder h3 { font-size:85px; }
.ct-merge { display:grid; grid-template-columns:650px 170px 1fr; align-items:center; gap:35px; }
.ct-field-table > div { border-top:2px solid var(--cp-line); padding:18px 0 24px; }
.ct-field-table > div:last-child { border-bottom:2px solid var(--cp-line); }
.ct-field-table span,.ct-retention span { display:block; font:26px/1.4 Mono,Xihei,monospace; color:var(--cp-dim); margin-bottom:14px; }
.ct-field-table b { font:44px/1.3 Xihei,sans-serif; }
.ct-merge-arrow { text-align:center; color:var(--cp-red); font:94px/1 Xihei,sans-serif; }
.ct-merged { border-left:2px solid var(--cp-ink); padding:36px 0 36px 42px; }
.ct-merged h3 { font-size:56px; }
.ct-merge-caption { margin-top:57px; padding-top:23px; border-top:1px solid var(--cp-line); font-size:30px; }
.ct-pending, .ct-rescue { display:grid; grid-template-columns:1fr 718px; align-items:center; gap:65px; }
.ct-pending-sheet { padding:32px 40px; background:#e9e8e2; }
.ct-pending-sheet > div { display:flex; justify-content:space-between; padding:10px 0; border-top:1px solid var(--cp-line); font:39px/1.4 Mono,Xihei,monospace; }
.ct-rescue p { font-size:34px; }
.ct-capture-pair { grid-template-columns:1fr 872px; gap:74px }
.ct-proof { border-block:2px solid var(--cp-line); padding:26px 0; }
.ct-screen-crop { position:relative; overflow:hidden; flex-shrink:0 }
.ct-screen-crop img { display:block; position:absolute; max-width:none; height:auto; }
.ct-action-detail { margin-top:20px; border-left:4px solid var(--cp-red); padding-left:16px }
.ct-trash-proof { padding-inline:22px }
.ct-trash-row { display:flex; align-items:center; justify-content:space-between; }
.ct-retention { display:flex; flex-wrap:wrap; gap:30px 55px; }
.ct-retention strong { font:700 115px/1 Doto,Mono,monospace; letter-spacing:-6px; }
.ct-retention small { flex:1 0 100%; font:27px/1.4 Mono,Xihei,monospace; color:var(--cp-dim); }
.ct-restore-seq > div { display:flex; gap:30px; align-items:center; border-top:2px solid var(--cp-line); padding:23px 0; font:37px/1.35 Xihei,sans-serif; }
.ct-restore-seq b { font:30px/1 Mono,monospace; color:var(--cp-dim); }
`;

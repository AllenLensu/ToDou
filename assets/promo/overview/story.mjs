// Each crop is expressed in pixels of the original 1548 × 988 product capture.
function crop(file, x, y, width, height, displayWidth, alt) {
  const scale = displayWidth / width;
  return `<div class="focus" style="width:${displayWidth}px;height:${height * scale}px"><img src="stills/${file}.png" alt="${alt}" style="width:${1548 * scale}px;left:${-x * scale}px;top:${-y * scale}px"></div>`;
}

const header = name => `<header class="edge"><span class="brand">ToDou</span><span>${name}</span></header>`;
const foot = (time, text) => `<div class="footnote"><span class="index">${time}</span><span>${text}</span></div>`;
function plate(file, region, width, label) {
  return `<figure class="plate-wrap">${crop(file, ...region, width, label)}<figcaption class="shot-caption quiet">${label}</figcaption></figure>`;
}

const intro = {
  id:'intro',title:'周六去拍日出',seconds:7,
  html:`<div class="ov hero">
    <div class="hero-card"><header class="edge"><span class="brand">ToDou</span><span>1.7</span></header>
      <div class="hero-titles"><span class="k">SATURDAY, NOV 28</span><span class="stamp">05:15</span>
      <h1><span class="title-line">周六去</span><span class="title-line">拍日出。</span></h1>
      <p class="h-foot">一份从家里带到海边的待办清单</p></div>
      <span class="shot-caption">WEB / WINDOWS / ANDROID</span></div>
    <div class="clipbox cover-photo"><img class="photo" src="photos/breakwater.jpg" alt="清晨海堤"><div class="shutter"></div></div></div>`,
  animate(tl,el){
    tl.from(el.querySelector('.stamp'),{opacity:0,duration:.55},.12)
      .from(el.querySelectorAll('.title-line'),{y:35,opacity:0,stagger:.18,duration:.7,ease:'power3.out'},.65)
      .from(el.querySelector('.h-foot'),{opacity:0,duration:.7},2.1)
      .to(el.querySelector('.shutter'),{scaleY:0,duration:1.2,ease:'power3.inOut'},1.1)
      .fromTo(el.querySelector('.photo'),{scale:1.105},{scale:1.015,duration:6.9,ease:'sine.out'},0);
  }
};

const capture = {
  id:'capture',title:'一句话记下出发时间',seconds:12,
  html:`<div class="ov">${header('QUICK CAPTURE')}
    <div class="topline"><h2>先记下出发的时间。</h2></div>
    <div class="capture-board"><div class="quote-line"><span class="typedbit">周六早上</span><span class="typedbit">五点一刻</span><br><span class="typedbit">去拍日出</span><i class="underline"></i></div>
    <div class="exposure"><span class="k">11.28　SAT</span><strong class="stamp">05:15</strong><span class="note">提醒我去拍日出</span></div></div>
    <div class="cap-photo">${crop('capture',139,235,408,156,660,'快速新建和识别到的提示')}<p class="note">点「使用识别结果」，日期和钟点就进了提醒。<br>直接按 Enter，也能把整句话当标题保存。</p></div></div>`,
  animate(tl,el){
    tl.from(el.querySelectorAll('.typedbit'),{opacity:0,y:14,stagger:.5,duration:.35},.6)
      .from(el.querySelector('.underline'),{scaleX:0,duration:.45},2.15)
      .from(el.querySelector('.exposure'),{clipPath:'inset(100% 0 0 0)',duration:.75},2.7)
      .from(el.querySelector('.cap-photo'),{y:18,opacity:0,duration:.55},4.9);
  }
};

const batch = {
  id:'batch',title:'成批录入、逐行取舍',seconds:11,
  html:`<div class="ov batch">${header('BATCH ENTRY')}<div class="split"><div class="side"><span class="k quiet">行前准备</span>
      <h2>要带的东西，<br>一行写一件。</h2><p class="note">电池要充电，路线已经下载。<br>勾选要创建的行，再选哪条需要提醒。</p></div>
      ${plate('batch',[138,280,414,463],610,'WEB 1.7　／　批量录入')}</div>
      ${foot('03 → 02','三行草稿，留下两项任务。只有出发那一项采用了识别出的提醒。')}</div>`,
  animate(tl,el){
    tl.from(el.querySelector('.plate-wrap'),{clipPath:'inset(0 0 94% 0)',duration:1.2,ease:'power2.inOut'},.55)
      .from(el.querySelector('.side .note'),{opacity:0,y:12,duration:.45},2.0)
      .from(el.querySelector('.footnote'),{opacity:0,duration:.55},5.3);
  }
};

const organize = {
  id:'organize',title:'把出发和到达分开安排',seconds:11,
  html:`<div class="ov">${header('TASK DETAIL')}<div class="task-spread">
    <figure class="clipbox gear-photo"><img class="photo" src="photos/equipment.jpg" alt="打包到一半的相机和地图"><div class="task-insert">${crop('task',677,217,707,589,730,'任务详情：备注、优先级、截止和提醒')}<div class="shot-caption quiet">WEB 1.7　／　编辑任务</div></div></figure>
    <div class="task-data"><div class="k quiet">11.28　／　周六</div><h2>天亮前，到海堤。</h2>
      <div class="fact"><span>任务</span><b>周六去拍日出</b></div><div class="fact"><span>提醒</span><b>05:15　出发</b></div>
      <div class="fact"><span>截止</span><b>06:10　到达海堤</b></div><div class="fact"><span>优先级</span><b>高</b></div>
      <p class="note">集合点写进备注，路线放进链接。<br>修改已有任务时，详情会自动保存。</p></div></div>
    ${foot('DETAIL','还可以关联另一项任务，从详情直接跳过去。')}</div>`,
  animate(tl,el){
    tl.from(el.querySelector('.photo'),{scale:1.1,duration:8,ease:'sine.out'},0)
      .from(el.querySelectorAll('.fact'),{y:14,opacity:0,duration:.45,stagger:.9},1.2)
      .fromTo(el.querySelector('.task-insert'),{autoAlpha:1,clipPath:'inset(0 100% 0 0)'},{autoAlpha:1,clipPath:'inset(0 0% 0 0)',duration:.7,immediateRender:false},5.0)
      .from(el.querySelector('.task-data .note'),{opacity:0,duration:.45},5.1)
      .from(el.querySelector('.footnote'),{opacity:0,duration:.45},7.25);
  }
};

const steps = {
  id:'steps',title:'子任务和各自到点的检查项',seconds:12,
  html:`<div class="ov">${header('CHECKLIST')}<div class="check-head"><h2>相机包装好了什么？</h2><span class="stamp">1/3</span></div>
    <div class="steps-pane"><div><span class="k quiet">周五 21:00</span><h3>把备用电池<br>放进相机包。</h3><p class="note">这一步有自己的提醒，<br>会单独出现在日程里。</p></div>
    ${plate('checklist',[675,580,705,269],1040,'WEB 1.7　／　任务里的三个检查项')}</div>
    ${foot('TASK / STEP','需要单独跟进的事拆成子任务。装包这样的步骤，可以各写备注、逐项勾掉。')}</div>`,
  animate(tl,el){
    tl.from(el.querySelector('.stamp'),{opacity:0,duration:.45},.55)
      .from(el.querySelector('.plate-wrap'),{clipPath:'inset(0 0 100% 0)',duration:1.1,ease:'power2.inOut'},1.3)
      .from(el.querySelector('.steps-pane .note'),{opacity:0,duration:.5},4.2)
      .from(el.querySelector('.footnote'),{opacity:0,duration:.5},7.35);
  }
};

const find = {
  id:'find',title:'搜索、分类和常用筛选',seconds:13,
  html:`<div class="ov">${header('SEARCH / SAVED FILTERS')}<div class="find-head"><h2>下次还找得到。</h2><div class="query"><small>/</small>备用电池</div></div>
    <div class="find-body">${plate('filter',[605,418,803,362],950,'WEB 1.7　／　保存在本机的筛选条件')}
    <div><span class="k quiet">分类：摄影　／　标签：周末</span><h3 class="filters-word">周末摄影</h3>
    <p class="note">把当前视图、搜索词和筛选条件存成一个名字。下次点它，就能调回这份清单。</p></div></div>
    ${foot('/ SEARCH','按 / 搜标题、备注、检查项、分类或标签。分类与标签可在设置里改名、整理。')}</div>`,
  animate(tl,el){
    tl.from(el.querySelector('.query'),{clipPath:'inset(0 100% 0 0)',duration:.65},.7)
      .from(el.querySelector('.plate-wrap'),{opacity:0,x:22,duration:.6},2.0)
      .from(el.querySelector('.filters-word'),{opacity:0,duration:.4},3.65)
      .from(el.querySelector('.find-body .note'),{opacity:0,duration:.5},4.4)
      .from(el.querySelector('.footnote'),{opacity:0,duration:.5},8);
  }
};

const agenda = {
  id:'agenda',title:'今天和未来七天',seconds:14,
  html:`<div class="ov">${header('SEVEN-DAY AGENDA')}<div class="agenda-body">
    <div class="agenda-left"><span class="k quiet">未来七天</span><h2>哪天最忙？</h2><strong class="stamp">11/27</strong>
    <p class="note">周五有两件事。看一眼云量，再把备用电池装进包。</p></div>
    <div class="agenda-right">${plate('agenda',[603,364,810,508],1040,'WEB 1.7　／　点有安排的日期，即可跳到当天第一项')}</div></div>
    ${foot('TODAY','「今天」也列出尚未处理的逾期事项。顶栏随时显示逾期数、今日数量和下一提醒。')}</div>`,
  animate(tl,el){
    tl.from(el.querySelector('.agenda-right'),{opacity:0,duration:.65},.5)
      .from(el.querySelector('.stamp'),{clipPath:'inset(0 100% 0 0)',duration:.7},1.8)
      .from(el.querySelector('.agenda-left .note'),{opacity:0,y:16,duration:.5},3.5)
      .from(el.querySelector('.footnote'),{opacity:0,duration:.55},8.1);
  }
};

const copy = {
  id:'copy',title:'把日程复制给同行人',seconds:9,
  html:`<div class="ov night">${header('COPY AGENDA')}<div class="copy-desk"><div><span class="k quiet">发给同行人</span><h2>周五要做的，<br>发你一份。</h2>
    <p class="note">在「今天」或「即将到来」点「复制当前日程」，就能把筛选后的清单贴进消息。</p></div>
    <div class="receipt"><div class="k">日程摘录</div><div class="r-date">11月27日周五</div>
    <div class="r-line">- [ ] 18:00 [任务] 看一眼周末的云量</div><div class="r-line">- [ ] 21:00 [检查项] 把备用电池放进相机包</div>
    <div class="shot-caption">每行带时间，并标明任务或检查项。</div></div></div></div>`,
  animate(tl,el){
    tl.from(el.querySelector('.receipt'),{clipPath:'inset(0 0 100% 0)',duration:.75},.7)
      .from(el.querySelectorAll('.r-line'),{opacity:0,x:15,stagger:.7,duration:.4},2.1)
      .from(el.querySelector('.shot-caption'),{opacity:0,duration:.5},4.3);
  }
};

const appearance = {
  id:'appearance',title:'同一清单的两种外观',seconds:9,
  html:`<div class="ov night">${header('LANGUAGE / APPEARANCE')}<div class="appearance-grid">
    <div class="side"><span class="k quiet">显示偏好</span><h2>天黑之后。</h2>
    <div class="phases ap-readout"><span class="phase">中文</span><span class="phase">English</span></div>
    <p class="note">明暗外观可以跟随系统。<br>中英文也可以单独切换。</p>
    <div class="empty-art"><div class="empty-glyphs">__EMPTY_ARTWORK__</div><span class="shot-caption">清单空着时的六幅插图</span></div></div>
    <div><div class="mode-stack">${crop('capture',120,25,1308,951,1060,'浅色中文清单')}${crop('appearance',120,25,1308,951,1060,'深色英文清单')}</div></div></div></div>`,
  animate(tl,el){
    tl.from(el.querySelector('.mode-stack'),{opacity:0,duration:.55},.25)
      .set(el.querySelectorAll('.phase')[0],{autoAlpha:0},3.5)
      .fromTo(el.querySelectorAll('.phase')[1],{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.4},3.5)
      .fromTo(el.querySelectorAll('.focus')[1],{autoAlpha:1,clipPath:'inset(0 100% 0 0)'},{autoAlpha:1,clipPath:'inset(0 0% 0 0)',duration:.8,ease:'power2.inOut',immediateRender:false},3.5)
      .from(el.querySelector('.empty-art'),{opacity:0,duration:.5},5.7);
  }
};

const access = {
  id:'access',title:'手机和键盘上的快捷入口',seconds:9,
  html:`<div class="ov">${header('APP SHORTCUTS')}<div class="access-grid">
    <div class="access-copy"><span class="k quiet">WEB / PWA</span><h2>出门带手机，<br>回家用键盘。</h2>
      <div class="entry-option"><span class="k">已安装的 PWA</span><p class="note">在支持的系统里，从图标快捷方式直接打开<br>「新建任务」或「今天的任务」。</p></div>
      <div class="entry-option keyboard"><span class="k">电脑上的清单</span><p class="note">N 新建　／　↑ ↓ 选任务　／　X 切换完成</p></div></div>
    <figure class="mobile-plate"><img src="stills/mobile.png" alt="窄屏任务列表和底部导航"><figcaption class="shot-caption quiet">WEB 1.7　／　窄屏任务页</figcaption></figure></div>
    <div class="access-foot shot-caption quiet">也可在局域网自托管。网页离线启动、系统通知和 OneDrive 登录需要 HTTPS 或本机回环地址。</div></div>`,
  animate(tl,el){
    tl.from(el.querySelector('.mobile-plate'),{opacity:0,y:16,duration:.5},.28)
      .from(el.querySelector('.entry-option'),{opacity:0,duration:.45},.7)
      .from(el.querySelector('.keyboard'),{opacity:0,duration:.45},3.1)
      .from(el.querySelector('.access-foot'),{opacity:0,duration:.45},4.15);
  }
};

const end = {
  id:'end',title:'拍到了',seconds:10,
  html:`<div class="ov end-scene"><div class="clipbox full-photo"><img class="photo" src="photos/breakwater.jpg" alt="海堤尽头的摄影人和刚刚升起的太阳"></div>
    <div class="end-titling"><span class="k">SAT　11.28　／　海堤</span><h2>拍到了。</h2></div>
    <div class="colophon"><div class="edge"><span class="brand">ToDou</span><span>1.7</span></div>
    <div><h2>ToDou</h2><p class="tagline">From To-Do to Ta-Da.</p></div>
    <div class="col-foot"><span class="note">一份能离线使用的待办清单</span><span class="k">WEB / WINDOWS / ANDROID</span></div></div></div>`,
  animate(tl,el){
    tl.fromTo(el.querySelector('.full-photo img'),{scale:1.08},{scale:1,duration:5.6,ease:'sine.out'},0)
      .from(el.querySelector('.end-titling'),{opacity:0,duration:.75},.65)
      .fromTo(el.querySelector('.colophon'),{autoAlpha:1,clipPath:'inset(100% 0 0 0)'},{autoAlpha:1,clipPath:'inset(0% 0 0 0)',duration:.85,immediateRender:false},5.15)
      .from(el.querySelector('.tagline'),{opacity:0,y:18,duration:.55},6.2);
  }
};

export const story=[intro,capture,batch,organize,steps,find,agenda,copy,appearance,access,end];

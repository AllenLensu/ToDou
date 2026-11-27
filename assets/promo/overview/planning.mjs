// Chapter timings are local. The assembly embeds this function in the film.
function animatePlanning(tl, el) {
  for (const item of el.querySelectorAll('[data-enter]')) {
    const start = Number(item.dataset.enter);
    const distance = item.hasAttribute('data-still') ? 0 : 16;
    tl.fromTo(item, { opacity: 0, y: distance }, {
      opacity: 1, y: 0, duration: .48, ease: 'power2.out', immediateRender: false,
    }, start);
  }
  const check = el.querySelector('.pf-check-path');
  if (check) {
    tl.fromTo(check, { strokeDashoffset: 75 }, {
      strokeDashoffset: 0, duration: .55, ease: 'power1.out', immediateRender: false,
    }, 2.2);
  }
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
  .map((day, index) => `<span class="pf-day${index === 5 ? ' pf-sat' : ''}">${day}</span>`).join('');
const dates = ['11.28', '12.05', '12.12', '12.19']
  .map((date, index) => `<b data-enter="${1.4 + index * .30}">${date}</b>`).join('');

const repeat = `<div class="pf pf-repeat">
  <header class="pf-head"><b>ToDou</b><span>重复规则 / RECURRENCE</span></header>
  <div class="pf-repeat-heading" data-enter=".15"><h2>下个周六，再来。</h2><p>固定日历</p></div>
  <div class="pf-calendar" data-enter=".45">
    <div class="pf-week">${weekdays}</div>
    <div class="pf-series">${dates}</div>
  </div>
  <div class="pf-calendar-note" data-enter="2.55">每周六拍一张，共四次。也可选每个工作日，或设结束日期。</div>
  <div class="pf-ledger">
    <div data-enter="4.45"><p>按完成日</p><h3>清完镜头，隔七天再提醒。</h3><small>下次时间随实际完成日期顺延。</small></div>
    <div data-enter="7.35"><p>临时改期</p><h3>周六有雨，改周日。</h3><small>选「仅此次」或「此次及以后」。</small></div>
    <div data-enter="10.25"><p>检查项</p><h3>装电池，跟随任务重复。</h3><small>也可为检查项单独设重复规则。</small></div>
  </div>
</div>`;

const template = `<div class="pf pf-template">
  <header class="pf-head"><b>ToDou</b><span>本机模板 / TEMPLATE</span></header>
  <div class="pf-template-grid">
    <div class="pf-template-copy">
      <h2 data-enter=".15">下次出门，<br>还带这份清单。</h2>
      <p class="pf-template-intro" data-enter=".58">把「周六去拍日出」存为本机模板。<br>从模板新建时，先选这次的基准日期。</p>
      <div class="pf-shift" data-enter="2.25"><strong>11.28</strong><i aria-hidden="true"></i><strong data-enter="2.85">12.05</strong></div>
      <div class="pf-rows">
        <div data-enter="4.15"><span>前一晚装好备用电池</span><b>12.04　21:00</b></div>
        <div data-enter="5.45"><span>出发提醒</span><b>12.05　05:15</b></div>
        <div data-enter="6.75"><span>拍摄截止</span><b>12.05　06:10</b></div>
      </div>
      <p class="pf-template-result" data-enter="8.65">核对预览，创建独立任务。</p>
    </div>
    <div class="pf-preview" data-enter="1.2" data-still>
      <p>模板预览 <span>WEB / ToDou</span></p>
      <div class="pf-crop"><img src="stills/template.png" alt="网页上的本机模板日期和检查项预览"></div>
    </div>
  </div>
</div>`;

const review = `<div class="pf pf-review">
  <header class="pf-head"><b>ToDou</b><span>完成任务 / FIELD NOTES</span></header>
  <div class="pf-review-grid">
    <figure class="pf-print" data-enter=".25" data-still>
      <div class="pf-print-image"><img src="photos/breakwater.jpg" alt="防波堤上的摄影师和海平线上初升的太阳"></div>
      <figcaption><b>11.28 / SAT</b><span>海边，第一束光。</span></figcaption>
    </figure>
    <div class="pf-review-copy">
      <div class="pf-clock" data-enter=".4">06:10</div>
      <h2 data-enter=".65">收工。</h2>
      <div class="pf-done" data-enter="1.5">
        <svg width="51" height="51" viewBox="0 0 56 56" aria-hidden="true"><rect x="3" y="3" width="50" height="50" rx="8" fill="none" stroke="currentColor" stroke-width="3"/><path class="pf-check-path" d="m13 29 11 11 20-25" fill="none" stroke="#d71921" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="75" stroke-dashoffset="75"/></svg>
        <span>周六去拍日出</span><b data-enter="2.35">已完成</b>
      </div>
      <div class="pf-policy" data-enter="3.15"><p>还有未完成的子项？</p>
        <ul><li>先完成全部子项</li><li>仅完成父任务</li><li>父子项一并完成</li></ul>
      </div>
    </div>
  </div>
  <div class="pf-review-foot">
    <div data-enter="6.55"><span>途中</span><p>按进度切换「进行中」「等待」或「暂停」。</p></div>
    <div data-enter="8.65"><span>编辑</span><p>详情自动保存，误删任务可在状态行撤销。</p></div>
  </div>
</div>`;

export const planning = [
  { id: 'repeat', title: '重复与改期', seconds: 14, html: repeat, animate: animatePlanning },
  { id: 'template', title: '本机模板', seconds: 12, html: template, animate: animatePlanning },
  { id: 'review', title: '完成与编辑', seconds: 12, html: review, animate: animatePlanning },
];

export const planningCSS = `
.pf {width:100%;height:100%;padding:66px 112px 72px;box-sizing:border-box;background:#f7f6f1;color:#171716;display:flex;flex-direction:column;font:32px/1.45 Xihei,sans-serif;}
.pf * {box-sizing:border-box;}
.pf h2,.pf h3,.pf p,.pf ul,.pf figure {margin:0;}
.pf h2,.pf h3,.pf b,.pf strong {font-weight:500;}
.pf [data-enter] {opacity:0;}
.pf-head {display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid currentColor;padding-bottom:18px;}
.pf-head b {font:600 37px/1 Grotesk,sans-serif;letter-spacing:-1.8px;}
.pf-head span,.pf-preview>p>span,.pf-print figcaption b {font:24px/1.3 Mono,Xihei,monospace;}
.pf h2 {font:500 101px/1.16 Xihei,sans-serif;letter-spacing:-4px;}
.pf-repeat-heading {display:flex;align-items:baseline;gap:48px;margin:73px 0 32px;}
.pf-repeat-heading p,.pf-ledger p,.pf-review-foot span,.pf-preview>p {font:27px/1.4 Mono,Xihei,monospace;color:#5c5b57;}
.pf-calendar {display:grid;grid-template-columns:400px 1fr;gap:60px;align-items:center;}
.pf-week {display:flex;justify-content:space-between;align-items:center;border:2px solid #85847d;padding:16px 18px;}
.pf-day {display:grid;place-content:center;width:44px;height:48px;font:28px/1 Xihei,sans-serif;}
.pf-sat {color:#fff;background:#bc1a20;border-radius:50%;}
.pf-series {display:flex;justify-content:space-between;align-items:center;border-top:2px solid #282825;border-bottom:2px solid #282825;padding:11px 0 15px;}
.pf-series b {font:65px/1.2 Mono,monospace;letter-spacing:-4px;}
.pf-calendar-note {margin:29px 0 0;font-size:34px;}
.pf-ledger {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px;margin-top:94px;}
.pf-ledger>div {border-top:3px solid #282825;padding:25px 0 0;}
.pf-ledger h3 {font:500 42px/1.35 Xihei,sans-serif;margin:34px 0 22px;}
.pf-ledger small {font:30px/1.5 Xihei,sans-serif;color:#52514d;}
.pf-template-grid {display:grid;grid-template-columns:1fr 660px;gap:100px;align-items:center;flex:1;}
.pf-template-copy h2 {font-size:86px;}
.pf-template-intro {font-size:31px;margin:24px 0 0!important;line-height:1.5;}
.pf-shift {display:flex;align-items:center;gap:29px;width:100%;margin:24px 0 25px;}
.pf-shift strong {font:72px/1.15 Mono,monospace;letter-spacing:-4px;}
.pf-shift strong:first-child {color:#686760;}
.pf-shift i {width:93px;height:2px;background:#bc1a20;position:relative;}
.pf-shift i::after {content:'';position:absolute;right:0;top:-6px;border-right:2px solid #bc1a20;border-top:2px solid #bc1a20;width:12px;height:12px;transform:rotate(45deg);}
.pf-rows {max-width:797px;border-bottom:1px solid #aaa99f;}
.pf-rows>div {display:flex;align-items:baseline;justify-content:space-between;border-top:1px solid #aaa99f;padding:12px 0;}
.pf-rows b {font:31px/1.4 Mono,Xihei,monospace;}
.pf-template-result {font-size:30px;margin:25px 0 0!important;}
.pf-preview {width:660px;}
.pf-preview>p {display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}
.pf-preview>p>span {font-size:20px;}
.pf-crop {width:660px;height:692px;border:2px solid #797872;background:#f7f6f1;overflow:hidden;position:relative;}
.pf-crop img {position:absolute;width:1919.52px;max-width:none;height:auto;left:-155px;top:-251px;}
.pf-review {background:#171716;color:#f7f6f1;}
.pf-review-grid {display:grid;grid-template-columns:920px 1fr;gap:91px;align-items:center;flex:1;}
.pf-print {background:#f7f6f1;color:#181818;padding:18px 18px 0;}
.pf-print-image {height:475px;overflow:hidden;}
.pf-print img {width:100%;height:100%;object-fit:cover;transform:scale(1.65);transform-origin:74% 70%;}
.pf-print figcaption {display:flex;justify-content:space-between;align-items:center;gap:16px;padding:17px 4px 20px;font:26px/1.3 Xihei,sans-serif;}
.pf-print figcaption b {font-size:21px;}
.pf-clock {font:700 99px/1 Doto,Mono,monospace;letter-spacing:-6px;margin-bottom:13px;}
.pf-review h2 {font-size:97px;}
.pf-done {display:flex;gap:20px;align-items:center;margin-top:33px;font:40px/1.2 Xihei,sans-serif;white-space:nowrap;}
.pf-done b {font:25px/1 Mono,Xihei,monospace;color:#c8c7c0;}
.pf-policy {margin-top:42px;border-top:2px solid #6a6a64;padding-top:18px;}
.pf-policy p {font-size:29px;color:#cecdc7;}
.pf-policy ul {padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;margin:11px 0 0;}
.pf-policy li {font:34px/1.3 Xihei,sans-serif;}
.pf-review-foot {display:grid;grid-template-columns:1fr 1fr;gap:50px;border-top:1px solid #6a6a64;padding-top:22px;}
.pf-review-foot>div {display:flex;align-items:baseline;gap:25px;}
.pf-review-foot span {color:#bebdb8;white-space:nowrap;}
.pf-review-foot p {font-size:28px;}
`;

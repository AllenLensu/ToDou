import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { story } from './story.mjs';
import { planning, planningCSS } from './planning.mjs';
import { continuity, continuityCSS } from './continuity.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source, '../../..');
const project = path.join(root, '.cache/sunrise');
const all = new Map([...story, ...planning, ...continuity].map(scene => [scene.id, scene]));
const order = ['intro','capture','batch','organize','steps','find','agenda','copy','repeat',
  'template','appearance','access','devices','offline','review','signals','sync','safety','end'];
const scenes = order.map(id => all.get(id));
const title = 'ToDou 1.7 · 周六去拍日出';
const duration = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
const dissolve = .38;
const styles = await readFile(path.join(source, 'field.css'), 'utf8');
// The Vue template contains six static illustrations. Use the product's paths verbatim.
const artwork = await readFile(path.join(root,'src/components/ui/EmptyStateArtwork.vue'),'utf8');
const drawings = Array.from(artwork.matchAll(/<template v-(?:if|else-if|else)\b[^>]*>([\s\S]*?)<\/template>/g),
  ([,shapes]) => `<svg viewBox="0 0 72 56" fill="none" aria-hidden="true">${shapes}</svg>`).join('');
if (drawings.split('<svg ').length !== 7) throw new Error('Expected six empty-state illustrations');
const gsap = process.argv[2] ?? path.join(root, '.cache/promo-tools/node_modules/gsap/dist/gsap.min.js');
await mkdir(path.join(project, 'media'), { recursive:true });
await Promise.all([
  cp(path.join(root,'public/fonts'), path.join(project,'fonts'), {recursive:true}),
  cp(path.join(source,'photos'),path.join(project,'photos'),{recursive:true}),
  cp(path.join(source,'stills'),path.join(project,'stills'),{recursive:true}),
  ...['pwa-icon.png','windows-tray.png','android-lock.png'].map(file =>
    copyFile(path.join(source,'../source/media',file),path.join(project,'media',file))),
  copyFile(path.join(source,'../source/score.m4a'),path.join(project,'score.m4a')),
  copyFile(gsap,path.join(project,'gsap.min.js')),
]);

let start = 0;
const metadata = [';FFMETADATA1', 'title=' + title];
const clips = [], animation = [];
for (const [i, scene] of scenes.entries()) {
  const {id,title:chapter,seconds,animate} = scene;
  const html = scene.html.replace('__EMPTY_ARTWORK__',drawings);
  const visible = seconds + (i === scenes.length - 1 ? 0 : dissolve);
  clips.push(`<section class="clip chapter" id="${id}" style="z-index:${i + 1}" data-start="${start}" data-duration="${visible}" data-track-index="${1 + i % 2}">${html}</section>`);
  // Object methods and standalone functions both become standalone function expressions.
  const fn = animate.toString().replace(/^animate\s*\(/,'function (');
  animation.push(`{
    const el=document.getElementById('${id}');
    const local=gsap.timeline({defaults:{ease:'power2.out'}});
    (${fn})(local,el);
    master.add(local,${start});
    ${i ? `master.fromTo(el,{clipPath:'inset(0 0 100% 0)'},{clipPath:'inset(0 0 0% 0)',duration:${dissolve},ease:'power2.inOut',immediateRender:false},${start});` : ''}
  }`);
  metadata.push('[CHAPTER]', 'TIMEBASE=1/1000','START='+start*1000,'END='+(start+seconds)*1000,'title='+chapter);
  start += seconds;
}
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${styles}\n${planningCSS}\n${continuityCSS}</style><script src="gsap.min.js"></script></head><body>
<div id="film" data-composition-id="sunrise" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
${clips.join('\n')}
<audio id="piano" src="score.m4a" data-start="0" data-duration="${duration}" data-track-index="3" data-volume="1"></audio>
</div><script>
const master=gsap.timeline({paused:true});
${animation.join('\n')}
window.__timelines={sunrise:master};
</script></body></html>`;
await writeFile(path.join(project,'index.html'),html);
await writeFile(path.join(project,'chapters.ffmeta'),metadata.join('\n')+'\n');
console.log(`${scenes.length} chapters · ${duration}s · ${project}`);

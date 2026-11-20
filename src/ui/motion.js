import {reducedMotion, onMotionChange} from './motion-preference.js';
export {reducedMotion, onMotionChange};
const active=new WeakMap(), running=new Set();
export function cancelMotion(element) {
  const animation=active.get(element);
  try {animation?.cancel();} catch { /* already gone */ }
  running.delete(animation);active.delete(element);
}
onMotionChange(reduced=>{if(reduced){for(const a of running)try{a.cancel();}catch{}running.clear();}});
export function motion(element,frames,duration=280) {
  if(!element)return;
  cancelMotion(element);
  if(reducedMotion()||typeof element.animate!=='function')return;
  try {
    const animation=element.animate(frames,{duration,easing:'cubic-bezier(.25,.1,.25,1)'});
    active.set(element,animation);running.add(animation);
    animation.finished.then(()=>{if(active.get(element)===animation)active.delete(element);running.delete(animation);}).catch(()=>running.delete(animation));
    return animation;
  }catch{ /* no hidden starting style is left behind when WAAPI fails */ }
}
export const reveal=element=>motion(element,[{opacity:.8,transform:'translateY(18px)'},{opacity:1,transform:'none'}],320);
export const numberChange=element=>motion(element,[{opacity:.75,transform:'translateY(10px)'},{opacity:1,transform:'none'}],280);
export function panelMotion(dialog,closing,from) {
  const axis=dialog.id==='cart-dialog'?'X':'Y',distance=dialog.id==='cart-dialog'?80:36;
  const current=from||getComputedStyle(dialog).transform;
  return motion(dialog,closing
    ?[{transform:current},{transform:`translate${axis}(${distance}px)`}]
    :[{transform:current==='none'?`translate${axis}(${distance}px)`:current},{transform:'none'}],closing?280:340);
}
export function enterPage() {
  if(performance.getEntriesByType('navigation')[0]?.type==='back_forward')return;
  reveal(document.querySelector('[data-page-enter]'));
}

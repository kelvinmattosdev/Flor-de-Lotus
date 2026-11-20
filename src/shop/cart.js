// Shape-only v2 loading is essential: a network outage must NOT discard unknown
// (new operator-created) IDs just because the historical seed cannot find them.
import {isID} from './schema.js';
export const STORAGE_KEY='flor-de-lotus:craft-sebo-cart:v2';
export const MAX_QUANTITY=9;
const valid=n=>Number.isInteger(n)&&n>=1&&n<=9;
export function normalizeCart(value){
  if(!Array.isArray(value))return [];
  const result=[];
  for(const i of value.slice(0,40)){
    if(!i||!isID(i.id)||typeof i.variant!=='string'||i.variant.length>120||!valid(i.quantity))continue;
    const previous=result.find(p=>p.id===i.id&&p.variant===i.variant);
    if(previous)previous.quantity=Math.min(9,previous.quantity+i.quantity);
    else result.push({id:i.id,variant:i.variant,quantity:i.quantity});
  }
  return result;
}
export function loadCart(storage){
  try{storage?.removeItem('flor-de-lotus:demo-cart:v1');}catch{}
  try{const raw=storage?.getItem(STORAGE_KEY);if(!raw||raw.length>50000)return [];const d=JSON.parse(raw);return d.version===2?normalizeCart(d.items):[];}catch{return [];}
}
export function saveCart(storage,cart){try{if(!storage)return false;const items=normalizeCart(cart);if(items.length)storage.setItem(STORAGE_KEY,JSON.stringify({version:2,items}));else storage.removeItem(STORAGE_KEY);return true;}catch{return false;}}
export const fingerprint=cart=>JSON.stringify(normalizeCart(cart).sort((a,b)=>a.id.localeCompare(b.id)||a.variant.localeCompare(b.variant)));
export const itemCount=cart=>normalizeCart(cart).reduce((n,i)=>n+i.quantity,0);
export function addItem(cart,product,variant,quantity){
  if(!valid(quantity)||product.mode!=='ready'||!(product.variants.length?product.variants.includes(variant):variant===''))throw new Error('Escolha uma opção e quantidade válidas de 1 a 9.');
  const next=normalizeCart(cart),old=next.find(i=>i.id===product.id&&i.variant===variant);
  if(old&&old.quantity+quantity>9)throw new Error('O limite é de 9 unidades por item e opção.');
  if(old)old.quantity+=quantity;else{if(next.length>=40)throw new Error('Limite de 40 itens diferentes.');next.push({id:product.id,variant,quantity});}return next;
}
export function setQuantity(cart,id,variant,quantity){if(!valid(quantity))throw new Error('Use uma quantidade de 1 a 9.');return normalizeCart(cart).map(i=>i.id===id&&i.variant===variant?{...i,quantity}:i);}
export const removeItem=(cart,id,variant)=>normalizeCart(cart).filter(i=>i.id!==id||i.variant!==variant);
export function reconcile(cart,official){
  const map=new Map(official.map(p=>[p.id,p])),removed=[];
  const items=normalizeCart(cart).filter(i=>{const p=map.get(i.id),ok=p?.mode==='ready'&&(p.variants.length?p.variants.includes(i.variant):i.variant==='');if(!ok)removed.push(i);return ok;});
  return{items,removed};
}
// Never clear a cart edited in another tab during a request, even if it contains
// some of the same IDs. The entire newer version stays for explicit user review.
export function settleCart(current,submitted){return fingerprint(current)===fingerprint(submitted)?{items:[],changed:false}:{items:normalizeCart(current),changed:true};}

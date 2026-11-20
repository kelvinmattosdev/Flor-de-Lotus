import {findProduct, products} from '../data/catalog.js';
export function discountPercent(price, compareAtPrice) {
  if(!Number.isSafeInteger(price)||!Number.isSafeInteger(compareAtPrice)||price<0||compareAtPrice<=price)return 0;
  return Math.round((compareAtPrice-price)*100/compareAtPrice);
}
export function ratingSummary(reviews=[]) {
  const demo=reviews.filter(r=>r.demo===true&&Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5);
  return {count:demo.length,average:demo.length?Math.round(demo.reduce((sum,r)=>sum+r.rating,0)*10/demo.length)/10:0};
}
export function productFromSearch(search) {
  const params=new URLSearchParams(search);
  const ids=params.getAll('id');
  return ids.length===1 && /^[A-Z0-9-]{1,60}$/.test(ids[0]) ? findProduct(ids[0]) : undefined;
}
export function relatedProducts(product, limit=3) {
  return products.filter(p=>p.id!==product.id).sort((a,b)=>{
    const rank=p=>p.category===product.category?0:p.family===product.family?1:2;
    return rank(a)-rank(b);
  }).slice(0,limit);
}
export function selectedQuantity(value) {
  if(!/^[1-9]$/.test(String(value)))throw new RangeError('Escolha uma quantidade inteira de 1 a 9.');
  return Number(value);
}

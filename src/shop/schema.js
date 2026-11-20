export const isID=id=>typeof id==='string'&&/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(id);
export const isUUID=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const cents=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000000;
const text=(s,max)=>{if(typeof s!=='string'||s.length>max)throw new Error('Texto inválido no catálogo.');return s;};
function humanName(value,field,max){
  const fail=message=>{throw Object.assign(new Error(message),{field});};
  if(typeof value!=='string'||/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(value))fail('Use texto sem controles, caracteres invisíveis ou quebras de linha.');
  const result=value.trim(),size=[...result].length;
  if(size<2||size>max)fail(`Use de 2 a ${max} caracteres.`);
  return result;
}
export const nicknameValue=value=>humanName(value,'nickname',60);
export function recipientName(value){
  const name=humanName(value,'recipientFullName',120);
  if(!/\p{L}/u.test(name)||!/^[\p{L}\p{M}\p{Zs}'’.‐‑-]+$/u.test(name))throw Object.assign(new Error('Use letras, espaços, apóstrofos, hífens ou pontos em um nome fictício.'),{field:'recipientFullName'});
  return name;
}
export function mediaURL(value){
  if(typeof value!=='string')return '';
  return /^\/images\/(?:artesanato|sebo|marca)\/[a-z0-9-]+\.(?:jpg|png)$/.test(value)||/^\/api\/v1\/catalogo\/imagens\/[a-f0-9-]{36}$/.test(value)?value:'';
}
export function mediaSrcset(value){
  if(!value)return '';
  if(typeof value!=='string')return '';
  const candidates=value.split(',').map(s=>s.trim().split(/\s+/));
  return candidates.length<=12&&candidates.every(([url,width,...rest])=>!rest.length&&mediaURL(url)&&/^[1-9][0-9]{0,4}w$/.test(width))?candidates.map(c=>c.join(' ')).join(', '):'';
}
export function listing(dto){
  if(!dto||!isID(dto.id)||!isID(dto.categoryId)||!['ready','custom'].includes(dto.mode)||dto.demo!==true)throw new Error('Anúncio inválido.');
  if(dto.mode==='ready'&&(!cents(dto.priceCents)||dto.priceCents<1||dto.priceCents>10000000))throw new Error('Preço inválido.');
  const compare=dto.compareAtPriceCents;
  if(compare!=null&&(!cents(compare)||compare<=dto.priceCents))throw new Error('Preço de comparação inválido.');
  if(!Array.isArray(dto.variants)||dto.variants.length>30||!dto.variants.every(v=>typeof v==='string'&&v.length<=120))throw new Error('Opções inválidas.');
  if(!Array.isArray(dto.gallery)||!dto.gallery.length||dto.gallery.length>5)throw new Error('Fotografias indisponíveis.');
  const gallery=dto.gallery.map(i=>{
    if(!mediaURL(i.src)||!mediaURL(i.thumb)||!Number.isInteger(i.width)||!Number.isInteger(i.height)||i.width<1||i.height<1||i.width>4000||i.height>4000)throw new Error('Imagem inválida.');
    return{src:mediaURL(i.src),thumb:mediaURL(i.thumb),srcset:mediaSrcset(i.srcset),width:i.width,height:i.height,alt:text(i.alt,240),label:text(i.label,80)};
  });
  const reviews=Array.isArray(dto.reviews)?dto.reviews.filter(r=>r.demo===true&&Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5).map(r=>({demo:true,rating:r.rating,author:text(r.author,120),text:text(r.text,3000)})):[];
  return{id:dto.id,categoryId:dto.categoryId,category:text(dto.categorySlug||'',60),family:text(dto.rootSlug||'',60),name:text(dto.name,120),detail:text(dto.detail||'',160),description:text(dto.description,3000),mode:dto.mode,price:dto.priceCents,compareAtPrice:compare,variants:[...dto.variants],gallery,reviews,demo:true};
}
export function categories(rows){
  const map=new Map(rows.map(r=>{
    if(!isID(r.id)||!(r.parentId===null||isID(r.parentId))||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug))throw new Error('Categoria inválida.');
    return[r.id,{id:r.id,parentId:r.parentId,slug:r.slug,name:text(r.name,120)}];
  }));
  if(map.size!==rows.length)throw new Error('Categorias duplicadas.');
  return [...map.values()].map(c=>{
    const names=[c.name],seen=new Set([c.id]);let parent=c.parentId;
    while(parent){if(seen.has(parent)||seen.size>=6||!map.has(parent))throw new Error('Hierarquia de categorias inválida.');seen.add(parent);const p=map.get(parent);names.unshift(p.name);parent=p.parentId;}
    return{...c,path:names.join(' › ')};
  });
}
export function quoteDTO(q){
  const sums=['subtotalCents','merchDiscountCents','shippingCents','shippingDiscountCents','totalCents'];
  if(!q||!isUUID(q.quoteId)||!Number.isFinite(Date.parse(q.expiresAt))||q.demo!==true||!sums.every(k=>cents(q[k]))||!Array.isArray(q.items)||!q.items.length||!Array.isArray(q.appliedCoupons)||!Array.isArray(q.rejectedCoupons))throw new Error('Prévia inválida; sua sacola foi mantida.');
  if(q.totalCents!==q.subtotalCents-q.merchDiscountCents+q.shippingCents-q.shippingDiscountCents)throw new Error('Totais inconsistentes.');
  for(const i of q.items)if(!isID(i.productId)||typeof i.variant!=='string'||typeof i.name!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>9||!['unitPriceCents','subtotalCents','discountCents','totalCents'].every(k=>cents(i[k])))throw new Error('Linha de prévia inválida.');
  if(typeof q.shippingName!=='string'||!['correios','sedex','jadlog','loggi'].includes(q.shippingId)||!['PIX_SIMULADO','CARTAO_SIMULADO'].includes(q.paymentMethod))throw new Error('Opções da prévia inválidas.');
  if(q.appliedCoupons.length>5||q.rejectedCoupons.length>5||q.appliedCoupons.some(c=>!c||typeof c.code!=='string'||!cents(c.merchDiscountCents)||!cents(c.shippingDiscountCents))||q.rejectedCoupons.some(c=>!c||typeof c.code!=='string'||typeof c.reason!=='string'))throw new Error('Cupons da prévia inválidos.');
  return q;
}
export function receiptDTO(r,q){
  if(!r||!isUUID(r.orderId)||r.demo!==true||r.status!=='PENDENTE'||r.totalCents!==q.totalCents||!isUUID(r.purchase?.id)||r.purchase.demo!==true||r.purchase.state!=='SIMULADO')throw new Error('Recibo não confirmado. Retente com a mesma chave; a sacola foi mantida.');
  return r;
}

import {api,allPages} from './api.js';
import {listing,categories,isID} from './schema.js';
const cache=new Map();
export const findProduct=id=>cache.get(id);
const remember=p=>{cache.set(p.id,p);return p;};
export async function getProduct(id){
  if(!isID(id))return null;
  try{return remember(listing(await api.request('/catalogo/anuncios/'+encodeURIComponent(id))));}
  catch(e){if(e.status===404)return null;throw e;}
}
export async function getProductsByIDs(ids){
  const unique=[...new Set(ids)].filter(isID);
  if(unique.length>40)throw new Error('A sacola excede 40 itens.');
  if(!unique.length)return [];
  const result=await api.request('/catalogo/anuncios?ids='+unique.map(encodeURIComponent).join(','));
  // The ids endpoint uses the same list envelope, without pagination.
  if(!Array.isArray(result.items))throw new Error('Catálogo indisponível. A sacola foi mantida.');
  return result.items.map(p=>remember(listing(p)));
}
export const getCategories=async()=>categories(await allPages(api.request,'/catalogo/categorias'));
export async function getProducts(categoryId){
  return(await allPages(api.request,'/catalogo/anuncios'+(categoryId?'?categoryId='+encodeURIComponent(categoryId)+'&includeDescendants=true':''))).map(p=>remember(listing(p)));
}

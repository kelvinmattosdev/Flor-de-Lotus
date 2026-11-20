export const $ = selector => document.querySelector(selector);
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${name}-symbol"/></svg>`;
export const closeButton = label => `<button class="icon-button" data-close aria-label="${escape(label)}">${icon('close')}</button>`;
export const productURL = id => `/produto.html?id=${encodeURIComponent(id)}`;
export const imageTag = (image, className = '', maxWidth = 300, decorative = false, eager = false) => {
  const width=Number.isInteger(image?.width)&&image.width>0&&image.width<=4000?image.width:300;
  const height=Number.isInteger(image?.height)&&image.height>0&&image.height<=4000?image.height:300;
  const src=mediaURL(image?.src);
  if(!src)return '<span class="small-note">Imagem indisponível.</span>';
  return `<img class="${escape(className)}" src="${escape(src)}" srcset="${escape(mediaSrcset(image.srcset))}" sizes="${Math.min(width,maxWidth)}px" width="${width}" height="${height}" alt="${decorative?'':escape(image.alt||'')}" loading="${eager?'eager':'lazy'}" ${eager?'fetchpriority="high"':''} decoding="async" style="--photo-width:${width}px" data-source="client" data-subject="Referência fornecida para teste local">`;
};
export function wireImages(root = document) {
  root.querySelectorAll('img:not([data-error-wired])').forEach(image => {
    image.dataset.errorWired = 'true';
    const fail = () => image.parentElement.classList.add('image-unavailable');
    image.addEventListener('error', fail, { once:true });
    if (image.complete && !image.naturalWidth) fail();
  });
}
import {mediaURL,mediaSrcset} from '../shop/schema.js';

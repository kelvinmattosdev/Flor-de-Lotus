import { products } from '../src/data/catalog.js';

const categories = [
  ['artesanato', null, 'Artesanato'],
  ['brincos', 'artesanato', 'Brincos'],
  ['colares', 'artesanato', 'Colares'],
  ['chaveiros', 'artesanato', 'Chaveiros'],
  ['bolsas', 'artesanato', 'Bolsas'],
  ['sebo', null, 'Sebo'],
  ['livros', 'sebo', 'Livros'],
  ['discos', 'sebo', 'Discos']
];
const categoryId = slug => `CAT-${slug.toUpperCase()}`;

const names = new Set([
  ...['assinatura-64', 'assinatura-128', 'identidade-368', 'identidade-736',
    'identidade-preto-368', 'identidade-preto-736'].map(name => `images/marca/${name}.jpg`),
  'fonts/cormorant-roman.woff2', 'fonts/cormorant-italic.woff2', 'fonts/dm-sans.woff2',
  'licenses/cormorantgaramond-OFL.txt', 'licenses/dmsans-OFL.txt'
]);

for (const {gallery} of products) for (const {src, thumb, srcset} of gallery) {
  for (const source of [src, thumb, ...srcset.split(', ').map(item => item.split(' ')[0])]) {
    if (!/^\/images\/(?:artesanato|sebo)\/[a-z0-9-]+\.(?:jpg|png)$/.test(source)) {
      throw new Error('Referência de catálogo histórica fora da política de ativos.');
    }
    names.add(source.slice(1));
  }
}
export const isApprovedAsset = name => names.has(name);

export function seedV1(db) {
  const category = db.prepare('INSERT INTO categories(id,parent_id,slug,name,active) VALUES(?,?,?,?,1)');
  for (const [slug, parent, title] of categories) category.run(categoryId(slug), parent ? categoryId(parent) : null, slug, title);
  const listing = db.prepare(`
    INSERT INTO listings(id,category_id,name,detail,description,mode,price,compare_at,variants,reviews,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,'PUBLISHED')`);
  const photo = db.prepare(`
    INSERT INTO listing_images(id,listing_id,position,width,height,alt,label,static_src,static_thumb,static_srcset)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const product of products) {
    listing.run(product.id, categoryId(product.category), product.name, product.detail, product.description,
      product.mode, product.price, product.compareAtPrice, JSON.stringify(product.variants), JSON.stringify(product.reviews));
    product.gallery.forEach((image, index) => {
      // Deterministic UUIDs for the curated legacy images; never portable filesystem paths.
      const id = `00000000-0000-4000-8000-${String(products.indexOf(product) * 10 + index + 1).padStart(12, '0')}`;
      photo.run(id, product.id, index, image.width, image.height, image.alt, image.label, image.src, image.thumb, image.srcset);
    });
  }
}

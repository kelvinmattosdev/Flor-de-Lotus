import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { boolean, boolQuery, catalogId, conflict, integer, invalid, missing, oneOf, pagination, shape, text, unavailable, uuid } from './http.js';

const STATES = ['DRAFT', 'PUBLISHED', 'INACTIVE'];
const CATEGORY_FIELDS = ['parentId', 'slug', 'name', 'active'];
const LISTING_FIELDS = ['categoryId', 'name', 'detail', 'description', 'mode', 'priceCents', 'compareAtPriceCents', 'variants'];
const MAX_CATEGORIES = 500;
const MAX_LISTINGS = 3000;
const allocatedId = prefix => `${prefix}-${randomUUID().toUpperCase()}`;

export function categoryTree(rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const ancestry = id => {
    const list = [];
    const visited = new Set();
    for (let next = id; next !== null; ) {
      const row = byId.get(next);
      if (!row || visited.has(next)) return null;
      visited.add(next);
      list.push(row);
      next = row.parent_id;
    }
    return list;
  };
  const active = id => ancestry(id)?.every(row => Boolean(row.active)) ?? false;
  return {byId, ancestry, active};
}

const categoryDto = (row, admin = false) => ({
  id: row.id, parentId: row.parent_id, slug: row.slug, name: row.name,
  ...(admin ? {active: Boolean(row.active), version: row.version} : {})
});

function imageDto(row, admin = false) {
  const src = row.static_src ?? `/api/v1/${admin ? 'operador' : 'catalogo'}/imagens/${row.id}`;
  return {id: row.id, src, thumb: row.static_thumb ?? src, srcset: row.static_srcset ?? '',
    width: row.width, height: row.height, alt: row.alt, label: row.label};
}

function categoryInput(body, row) {
  shape(body, row ? ['version', 'parentId', 'name', 'active'] : CATEGORY_FIELDS,
    row ? ['version'] : ['parentId', 'slug', 'name']);
  const parentId = Object.hasOwn(body, 'parentId') ? body.parentId : row?.parent_id ?? null;
  const slug = row?.slug ?? text(body.slug, 'slug', 60);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid('slug');
  return {
    id: row?.id ?? allocatedId('CAT'), parent_id: parentId === null ? null : catalogId(parentId, 'parentId'), slug,
    name: Object.hasOwn(body, 'name') ? text(body.name, 'name', 120) : row.name,
    active: Object.hasOwn(body, 'active') ? Number(boolean(body.active, 'active')) : row?.active ?? 1
  };
}

const versionGuard = (body, row) => {
  if (integer(body.version, 'version', 1, Number.MAX_SAFE_INTEGER) !== row.version) {
    conflict('VERSION_CONFLICT', 'O registro mudou. Recarregue antes de editar.');
  }
};

function listingInput(body, row) {
  shape(body, row ? [...LISTING_FIELDS, 'version', 'state', 'images'] : LISTING_FIELDS, row
    ? ['version'] : ['categoryId', 'name', 'description', 'mode', 'priceCents']);
  const value = (key, fallback) => Object.hasOwn(body, key) ? body[key] : fallback;
  const mode = oneOf(value('mode', row?.mode), ['ready', 'custom'], 'mode');
  const price = value('priceCents', row?.price ?? null);
  const compare = value('compareAtPriceCents', row?.compare_at ?? null);
  if (mode === 'custom') {
    if (price !== null || compare !== null) invalid('priceCents', 'Encomenda informativa não tem preço.');
  } else {
    integer(price, 'priceCents', 1, 10000000);
    if (compare !== null) integer(compare, 'compareAtPriceCents', price + 1, 10000000);
  }
  const variants = value('variants', row ? JSON.parse(row.variants) : []);
  if (!Array.isArray(variants) || variants.length > 12) invalid('variants');
  const cleaned = variants.map(entry => text(entry, 'variants', 60));
  if (new Set(cleaned).size !== cleaned.length) invalid('variants', 'Não repita variantes.');
  return {
    id: row?.id ?? allocatedId('FDL'), category_id: catalogId(value('categoryId', row?.category_id), 'categoryId'),
    name: text(value('name', row?.name), 'name', 120),
    detail: text(value('detail', row?.detail ?? ''), 'detail', 160, {optional: true}),
    description: text(value('description', row?.description), 'description', 3000, {multiline: true}),
    mode, price, compare_at: compare, variants: JSON.stringify(cleaned),
    state: oneOf(value('state', row?.state ?? 'DRAFT'), STATES, 'state')
  };
}

export function createCatalog(db) {
  const categoryRows = db.prepare('SELECT * FROM categories ORDER BY seq');
  const getCategory = db.prepare('SELECT * FROM categories WHERE id=?');
  const getListing = db.prepare('SELECT * FROM listings WHERE id=?');
  const imageRows = db.prepare(`SELECT id,listing_id,position,width,height,alt,label,static_src,static_thumb,static_srcset
    FROM listing_images WHERE listing_id=? ORDER BY position,id`);
  const tree = () => categoryTree(categoryRows.all());
  const listing = id => getListing.get(id);
  const gallery = id => imageRows.all(id);
  const publicListing = (row, hierarchy) => Boolean(row && row.state === 'PUBLISHED' && hierarchy.active(row.category_id));
  const canPublish = (row, hierarchy, images) => {
    if (!hierarchy.active(row.category_id)) invalid('categoryId', 'Escolha uma categoria ativa.');
    if (row.state === 'PUBLISHED' && (!images.length || images.some(image => !image.alt || !image.label))) {
      invalid('images', 'Para publicar, inclua uma imagem e preencha alt e rótulo em todas.');
    }
  };
  const dto = (row, hierarchy, admin) => {
    const chain = hierarchy.ancestry(row.category_id);
    return {
      id: row.id, categoryId: row.category_id, categorySlug: chain[0].slug, rootSlug: chain.at(-1).slug,
      name: row.name, detail: row.detail, description: row.description, mode: row.mode,
      priceCents: row.price, compareAtPriceCents: row.compare_at,
      variants: JSON.parse(row.variants), gallery: gallery(row.id).map(image => imageDto(image, admin)),
      reviews: JSON.parse(row.reviews), demo: true,
      ...(admin ? {state: row.state, version: row.version} : {})
    };
  };
  const editTree = (next, previous) => {
    const rows = categoryRows.all().filter(row => row.id !== previous?.id);
    const hierarchy = categoryTree([...rows, next]);
    if (next.parent_id && !hierarchy.byId.has(next.parent_id)) invalid('parentId', 'Categoria pai não encontrada.');
    if (next.parent_id && !hierarchy.active(next.parent_id)) invalid('parentId', 'Categoria pai precisa estar ativa e não pode ser descendente.');
    for (const row of hierarchy.byId.values()) {
      const ancestry = hierarchy.ancestry(row.id);
      if (!ancestry || ancestry.length > 6) invalid('parentId', 'A árvore não pode ter ciclos ou mais de seis níveis.');
    }
    if (!next.active && (rows.some(row => row.parent_id === next.id && row.active)
        || db.prepare("SELECT 1 FROM listings WHERE category_id=? AND state='PUBLISHED' LIMIT 1").get(next.id))) {
      conflict('STATE_CONFLICT', 'Inative os filhos ou retire os anúncios publicados antes de inativar a categoria.');
    }
  };
  return {
    tree, listing, publicListing,
    categories(params, admin) {
      const page = pagination(params, ['categories', admin]);
      const rows = categoryRows.all();
      const hierarchy = categoryTree(rows);
      return page.result(rows.filter(row => row.seq > page.after && (admin || hierarchy.active(row.id)))
        .slice(0, page.size), row => categoryDto(row, admin));
    },
    category(id) {
      const row = getCategory.get(catalogId(id));
      if (!row) missing();
      return categoryDto(row, true);
    },
    saveCategory(id, body) {
      return transaction(db, () => {
        const row = id ? getCategory.get(catalogId(id)) : null;
        if (id && !row) missing();
        const next = categoryInput(body, row);
        if (row) versionGuard(body, row);
        if (!row && db.prepare('SELECT count(*) AS count FROM categories').get().count >= MAX_CATEGORIES) unavailable();
        if (!row && db.prepare('SELECT 1 FROM categories WHERE slug=?').get(next.slug)) conflict('ALREADY_EXISTS', 'Já existe uma categoria com esse slug.');
        editTree(next, row);
        if (row) db.prepare('UPDATE categories SET parent_id=?,name=?,active=?,version=version+1 WHERE id=?')
          .run(next.parent_id, next.name, next.active, next.id);
        else db.prepare('INSERT INTO categories(id,parent_id,slug,name,active) VALUES(?,?,?,?,?)')
          .run(next.id, next.parent_id, next.slug, next.name, next.active);
        return categoryDto(getCategory.get(next.id), true);
      });
    },
    listings(params, admin) {
      const hierarchy = tree();
      if (params.ids !== undefined) {
        if (Object.keys(params).length !== 1) invalid('ids', 'Não combine ids com filtros ou paginação.');
        const ids = [...new Set(params.ids.split(','))];
        if (ids.length > 40) invalid('ids');
        const rows = ids.map(id => listing(catalogId(id, 'ids'))).filter(row => publicListing(row, hierarchy));
        return {items: rows.map(row => dto(row, hierarchy, false)), nextCursor: null};
      }
      const category = params.categoryId === undefined ? null : catalogId(params.categoryId, 'categoryId');
      const descendants = boolQuery(params.includeDescendants, 'includeDescendants');
      if (!category && params.includeDescendants !== undefined) invalid('includeDescendants');
      if (category && !hierarchy.active(category)) missing();
      const state = admin ? (params.state === undefined ? null : oneOf(params.state, STATES, 'state')) : 'PUBLISHED';
      const page = pagination(params, ['listings', admin, category, descendants, state]);
      const categories = category
        ? [...hierarchy.byId.keys()].filter(id => id === category ||
          (descendants && hierarchy.ancestry(id).some(node => node.id === category)))
        : admin ? null : [...hierarchy.byId.keys()].filter(id => hierarchy.active(id));
      if (categories?.length === 0) return {items: [], nextCursor: null};
      const filters = ['seq>?'];
      const args = [page.after];
      if (state) { filters.push('state=?'); args.push(state); }
      if (categories) { filters.push(`category_id IN (${categories.map(() => '?').join(',')})`); args.push(...categories); }
      const rows = db.prepare(`SELECT * FROM listings WHERE ${filters.join(' AND ')} ORDER BY seq LIMIT ?`).all(...args, page.size);
      return page.result(rows, row => dto(row, hierarchy, admin));
    },
    getListing(id, admin) {
      const row = listing(catalogId(id));
      const hierarchy = tree();
      if (!row || (!admin && !publicListing(row, hierarchy))) missing();
      return dto(row, hierarchy, admin);
    },
    saveListing(id, body) {
      return transaction(db, () => {
        const row = id ? listing(catalogId(id)) : null;
        if (id && !row) missing();
        const next = listingInput(body, row);
        if (row) versionGuard(body, row);
        if (!row && db.prepare('SELECT count(*) AS count FROM listings').get().count >= MAX_LISTINGS) unavailable();
        let images = row ? gallery(row.id) : [];
        if (Object.hasOwn(body, 'images')) {
          if (!Array.isArray(body.images) || body.images.length > 5) invalid('images');
          const ids = new Set();
          images = body.images.map((image, position) => {
            shape(image, ['id', 'alt', 'label'], ['id', 'alt', 'label']);
            const imageId = uuid(image.id, 'images');
            const current = images.find(entry => entry.id === imageId);
            if (!current || ids.has(imageId)) invalid('images', 'Informe IDs deste anúncio, sem repetição.');
            ids.add(imageId);
            return {...current, position, alt: text(image.alt, 'alt', 240), label: text(image.label, 'label', 80)};
          });
        }
        const hierarchy = tree();
        canPublish(next, hierarchy, images);
        if (row) {
          db.prepare(`UPDATE listings SET category_id=?,name=?,detail=?,description=?,mode=?,price=?,compare_at=?,variants=?,state=?,
            version=version+1 WHERE id=?`).run(next.category_id, next.name, next.detail, next.description, next.mode,
            next.price, next.compare_at, next.variants, next.state, next.id);
          if (Object.hasOwn(body, 'images')) {
            const retained = new Set(images.map(image => image.id));
            const drop = db.prepare('DELETE FROM listing_images WHERE id=? AND listing_id=?');
            const edit = db.prepare('UPDATE listing_images SET position=?,alt=?,label=? WHERE id=? AND listing_id=?');
            for (const image of gallery(row.id)) if (!retained.has(image.id)) drop.run(image.id, row.id);
            for (const image of images) edit.run(image.position, image.alt, image.label, image.id, row.id);
          }
        } else {
          db.prepare(`INSERT INTO listings(category_id,name,detail,description,mode,price,compare_at,variants,state,id)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(next.category_id, next.name, next.detail, next.description, next.mode,
            next.price, next.compare_at, next.variants, next.state, next.id);
        }
        return dto(listing(next.id), hierarchy, true);
      });
    },
    assertUpload(id) {
      const row = listing(catalogId(id));
      if (!row) missing();
      if (row.state === 'PUBLISHED') conflict('STATE_CONFLICT', 'Coloque o anúncio em rascunho para adicionar imagens.');
      if (gallery(id).length >= 5) invalid('images', 'O limite é de cinco fotos.');
      if ((db.prepare('SELECT coalesce(sum(length(bytes)),0) AS bytes FROM listing_images WHERE bytes IS NOT NULL').get().bytes ?? 0)
          >= 128 * 1024 * 1024) unavailable();
      return row;
    },
    addImage(id, image) {
      return transaction(db, () => {
        const row = this.assertUpload(id);
        const total = db.prepare('SELECT coalesce(sum(length(bytes)),0) AS bytes FROM listing_images WHERE bytes IS NOT NULL').get().bytes;
        if (total + image.bytes.length > 128 * 1024 * 1024) unavailable();
        const imageId = randomUUID();
        db.prepare(`INSERT INTO listing_images(id,listing_id,position,width,height,alt,label,mime,bytes)
          VALUES(?,?,?,?,?,'','',?,?)`).run(imageId, id, gallery(id).length, image.width, image.height, image.mime, image.bytes);
        db.prepare('UPDATE listings SET version=version+1 WHERE id=?').run(id);
        return {image: imageDto(gallery(id).find(item => item.id === imageId), true), version: row.version + 1};
      });
    },
    media(id, admin) {
      const row = db.prepare('SELECT listing_id,mime,bytes FROM listing_images WHERE id=? AND bytes IS NOT NULL').get(uuid(id));
      if (!row || (!admin && !publicListing(listing(row.listing_id), tree()))) missing();
      return row;
    },
    hasPublishedStaticImage(path) {
      const rows = db.prepare(`SELECT i.static_src,i.static_thumb,i.static_srcset,l.category_id
        FROM listing_images i JOIN listings l ON l.id=i.listing_id
        WHERE l.state='PUBLISHED' AND i.static_src IS NOT NULL`).all();
      const hierarchy = tree();
      return rows.some(row => hierarchy.active(row.category_id) && (row.static_src === path || row.static_thumb === path ||
        row.static_srcset.split(', ').some(item => item.split(' ')[0] === path)));
    }
  };
}

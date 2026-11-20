import {ApiError, resource} from './api.js';
import {diff} from './domain.js';
import {alerts, badge, band, button, fieldErrors, h, heading, text} from './ui.js';

export const limits = max => ({maxlength: max});
export const read = (form, name) => form.elements.namedItem(name).value.trim();
export const checked = (form, name) => form.elements.namedItem(name).checked;

export const fieldHints = {
  parentId: 'Escolha um pai ativo, fora desta subárvore. O limite é de seis níveis.',
  slug: 'Use letras minúsculas sem acento, números ou hífens entre palavras.',
  name: 'Informe um nome de até 120 caracteres.',
  categoryId: 'Escolha uma categoria ativa, com ancestrais ativos.',
  detail: 'Informe um detalhe de até 160 caracteres.',
  description: 'Informe uma descrição de até 3.000 caracteres.',
  variants: 'Use até 12 opções distintas, com até 60 caracteres por opção.',
  priceCents: 'Informe um preço entre R$ 0,01 e R$ 100.000,00.',
  compareAtPriceCents: 'O preço anterior deve ser maior que o preço de venda, ou ficar em branco.',
  code: 'Use de 2 a 32 letras sem acentos, números ou hífens.',
  scopeId: 'Selecione uma das opções disponíveis para este escopo.',
  percentBps: 'Informe de 0 a 100, com até duas casas decimais. Com 0%, marque frete grátis.',
  minSubtotalCents: 'Use um valor a partir de zero, sem separador de milhar.',
  maxDiscountCents: 'O teto precisa ser positivo e exige desconto percentual, ou deixe em branco.',
  image: 'A foto precisa ser um JPEG ou PNG estático válido, com até 3 MiB e 4 MP.',
  images: 'Verifique o limite de cinco fotos e preencha texto alternativo e legenda das fotos que ficam.'
};

export function editor(ctx, {title, description, back, initial, seed, labels, fieldsFor, onReopen}) {
  const messages = alerts();
  const review = h('div', {class: 'reconcile'});
  const fields = h('fieldset', {class: 'form-frame'});
  const form = h('form', {method: 'post', novalidate: true, class: 'record-form'}, fields);
  const head = heading(title, description, button(back.label, back.open));
  ctx.body.append(head, messages.node, review, form);
  let blocked = false;
  let signature;
  const isChanged = () => signature && signature() !== original;
  let original;

  function watch(takeSnapshot) {
    signature = takeSnapshot;
    original = signature();
    ctx.setDirty(isChanged);
  }

  function invalidate(errors, defaultCopy = 'Revise os campos indicados antes de salvar.') {
    const focused = fieldErrors(form, errors);
    const missing = Object.entries(errors).filter(([name]) => {
      const control = form.elements.namedItem(name);
      return !control?.id || control.disabled;
    }).map(([, value]) => value);
    messages.fail([defaultCopy, ...new Set(missing)].join(' '), !focused);
  }

  async function run(start, operation, {
    recordWrite = false, alwaysReconcile = false, onDone, onFieldError
  } = {}) {
    if (ctx.busy() || (recordWrite && blocked)) return;
    const origin = document.activeElement;
    fieldErrors(form);
    messages.say(start);
    ctx.setBusy(true);
    fields.disabled = true;
    let error;
    let result;
    try {
      result = await operation();
    } catch (failure) {
      error = failure;
    } finally {
      if (ctx.active()) {
        fields.disabled = false;
        ctx.setBusy(false);
      }
    }
    if (!ctx.active()) return;
    if (!error) {
      onDone?.(result);
      if (ctx.active() && document.activeElement === document.body && origin.isConnected) origin.focus();
      return;
    }
    const copy = await ctx.issue(error, ctx.area);
    if (!ctx.active() || !copy) return;
    if (recordWrite && (error.code === 'VERSION_CONFLICT' || alwaysReconcile && error.status === 409 ||
        (error instanceof ApiError && (!error.status || error.status >= 500)))) {
      if (initial) {
        requireReview(copy);
        return;
      }
      blockWrites();
      messages.fail(`${copy} O envio pode ter sido recebido. Volte à lista e confira antes de criar de novo.`, true);
      review.replaceChildren(band(text('O formulário fica disponível para consulta; um novo envio está bloqueado.')));
      return;
    }
    if (error.code === 'INVALID_INPUT' && onFieldError?.(error.field)) return;
    const hint = Object.hasOwn(fieldHints, error.field) ? fieldHints[error.field] : null;
    if (error.code === 'INVALID_INPUT' && hint) invalidate({[error.field]: hint}, copy);
    else messages.fail(copy, true);
  }

  function blockWrites() {
    blocked = true;
    for (const control of form.querySelectorAll('[type="submit"], [data-record-write]')) control.disabled = true;
  }

  function requireReview(copy) {
    blockWrites();
    messages.fail(copy);
    const consult = button('Consultar versão do servidor', async () => {
      await run('Consultando a versão no servidor…', () => ctx.api.request(resource(ctx.area, initial.id)), {
        onDone(latest) {
          const changed = Object.keys(diff(seed, fieldsFor(latest)));
          const notice = changed.length
            ? `Campos alterados no servidor desde a abertura: ${changed.map(key => labels[key] ?? key).join(', ')}.`
            : 'Nenhum campo exibido difere da versão inicial.';
          messages.say('Seus campos ainda estão no formulário.');
          const preview = h('div', {class: 'review-details', tabindex: '-1'},
            text(`Versão ${latest.version}. ${notice}`),
            text('Para continuar, carregue a versão do servidor. Isso substitui as alterações deste formulário que ainda não foram salvas.', 'muted'),
            button('Carregar versão e descartar minhas alterações', () => {
              if (ctx.busy()) return;
              if (!isChanged() || window.confirm('Descartar as alterações deste formulário e carregar a versão consultada?')) onReopen(latest);
            }));
          summary.replaceChildren(preview);
          preview.focus();
        }
      });
    }, 'button secondary');
    const summary = h('div');
    review.replaceChildren(band(consult, summary));
    consult.focus();
  }

  form.addEventListener('input', event => {
    const control = event.target;
    if (!control.id || !control.hasAttribute('aria-invalid')) return;
    control.removeAttribute('aria-invalid');
    const detail = document.getElementById(`${control.id}-erro`);
    if (detail) detail.textContent = '';
  });
  return {form, fields, messages, watch, invalidate, run, requireReview,
    blocked: () => blocked};
}

// Native access to immutable selections and checkbox values remains available
// even if hidden fields don't apply to the current scope/mode.
export const snapshot = (form, omit = []) => JSON.stringify([...new FormData(form)]
  .filter(([name]) => !omit.includes(name))
  .map(([name, value]) => [name, typeof value === 'string' ? value
    : value.name ? [value.name, value.size, value.lastModified] : null]));

export function versionBadge(record) {
  return record ? badge(`Versão ${record.version}`, 'neutral') : badge('Novo registro', 'neutral');
}

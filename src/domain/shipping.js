import {shippingOptions} from '../data/catalog.js';
export const formatCEP = value => {
  const digits=String(value).replace(/\D/g,'').slice(0,8);
  return digits.length>5?`${digits.slice(0,5)}-${digits.slice(5)}`:digits;
};
export const validCEP = value => /^(?:\d{8}|\d{5}-\d{3})$/.test(String(value));
export function quoteShipping(value) {
  if(!validCEP(value))throw new RangeError('Digite os 8 dígitos de um CEP de exemplo.');
  // Deliberately no geographic lookup. Same fixed illustrative quotes as checkout.
  return shippingOptions.map(option=>({...option,demo:true}));
}
// Latest-only task. No address/CEP is retained after synchronous validation.
export function createQuoteTask({schedule=setTimeout,cancel=clearTimeout}={}) {
  let generation=0,timer;
  const invalidate=()=>{generation++;if(timer!==undefined)cancel(timer);timer=undefined};
  return {
    cancel:invalidate,
    run(value,publish) {
      invalidate();
      const result=quoteShipping(value),current=generation;
      timer=schedule(()=>{timer=undefined;if(current===generation)publish(result)},260);
    }
  };
}

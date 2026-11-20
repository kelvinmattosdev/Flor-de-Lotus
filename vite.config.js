import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  // O caminho suportado e scripts/build.mjs: nunca expor public cru via npm.
  publicDir: false,
  build: {
    write: false,
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        product: fileURLToPath(new URL('./produto.html', import.meta.url)),
        account: fileURLToPath(new URL('./conta.html', import.meta.url)),
        operator: fileURLToPath(new URL('./operador.html', import.meta.url))
      }
    }
  }
});

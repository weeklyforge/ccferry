import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import 'vant/lib/index.css';
import './styles.css';

createApp(App).use(createPinia()).use(router).mount('#app');

// Minimal SW (push events only — no caching); registration failures are
// non-fatal (insecure contexts, private mode).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

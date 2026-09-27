import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sessions', component: () => import('./pages/Sessions.vue') },
    { path: '/session/:id', name: 'session', component: () => import('./pages/SessionView.vue') },
    { path: '/history', name: 'history', component: () => import('./pages/History.vue') },
    { path: '/new-task', name: 'new-task', component: () => import('./pages/NewTask.vue') },
    { path: '/vault', name: 'vault', component: () => import('./pages/Vault.vue') },
    { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
  ],
});

// A stale page after a deploy can ask for lazy chunks whose hashes no longer
// exist — the navigation dies silently and the tab feels frozen. Reload once
// onto the current bundle (guard flag prevents a reload loop).
const RELOADED_KEY = 'ccferry-chunk-reload';

router.onError((error, to) => {
  const message = error instanceof Error ? error.message : String(error);
  const chunkFailure = /import|chunk|fetch|Loading/i.test(message);
  if (!chunkFailure) return;
  if (sessionStorage.getItem(RELOADED_KEY) === to.fullPath) return;
  sessionStorage.setItem(RELOADED_KEY, to.fullPath);
  window.location.reload(); // the address bar already carries the target hash
});

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

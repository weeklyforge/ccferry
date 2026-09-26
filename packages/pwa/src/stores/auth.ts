import { defineStore } from 'pinia';

const TOKEN_KEY = 'ccferry-token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: safeGet(TOKEN_KEY),
    daemonBase: typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:8787',
  }),
  actions: {
    setToken(token: string) {
      this.token = token;
      safeSet(TOKEN_KEY, token);
    },
    clearToken() {
      this.token = '';
      safeSet(TOKEN_KEY, '');
    },
  },
});

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / storage disabled — keep in-memory only
  }
}

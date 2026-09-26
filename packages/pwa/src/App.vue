<script setup lang="ts">
import { Tabbar, TabbarItem } from 'vant';
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <router-view :key="route.fullPath" />
  <Tabbar route placeholder>
    <TabbarItem replace to="/" icon="chat-o">会话</TabbarItem>
    <TabbarItem replace to="/vault" icon="notes-o">知识库</TabbarItem>
    <TabbarItem replace to="/settings" icon="setting-o">设置</TabbarItem>
  </Tabbar>
</template>

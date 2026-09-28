// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import GuideCard from './GuideCard.vue';

describe('GuideCard', () => {
  it('shows the title and renders 「设置」 as an inline link, no button', () => {
    const wrapper = mount(GuideCard, {
      props: { title: '尚未授权', description: '先到「设置」页保存访问令牌' },
      global: { plugins: [createPinia()] },
    });
    expect(wrapper.text()).toContain('尚未授权');
    expect(wrapper.text()).toContain('先到');
    expect(wrapper.find('.guide-link').text()).toBe('「设置」');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

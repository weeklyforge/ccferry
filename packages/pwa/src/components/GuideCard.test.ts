// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import GuideCard from './GuideCard.vue';

describe('GuideCard', () => {
  it('shows the title, description, and a settings button', () => {
    const wrapper = mount(GuideCard, {
      props: { title: '尚未授权', description: '先去设置页保存访问令牌' },
      global: { plugins: [createPinia()] },
    });
    expect(wrapper.text()).toContain('尚未授权');
    expect(wrapper.text()).toContain('先去设置页保存访问令牌');
    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('去设置令牌');
  });
});

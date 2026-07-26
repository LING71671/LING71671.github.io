/**
 * 全站委托式交互：分享按钮、tab 面板切换、分类过滤。
 * 用事件委托而非组件内脚本，保证 partial 被注入覆盖面板后交互依然可用。
 * 由 ContentLayout 页面与首页各引入一次（模块去重）。
 */

function handleShare(btn: HTMLElement): void {
  const title = btn.dataset.shareTitle ?? document.title;
  const url = location.href;
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
    return;
  }
  const original = btn.textContent;
  navigator.clipboard
    ?.writeText(url)
    .then(() => {
      btn.textContent = '链接已复制 ✓';
      setTimeout(() => {
        btn.textContent = original;
      }, 2000);
    })
    .catch(() => {});
}

function handleTab(btn: HTMLElement): void {
  const bar = btn.closest<HTMLElement>('[data-tabs-scope]');
  const scope = bar?.dataset.tabsScope;
  const key = btn.dataset.tab;
  if (!bar || !scope || !key) return;

  for (const b of bar.querySelectorAll<HTMLElement>('[data-tab]')) {
    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
  }
  const panels = document.querySelector<HTMLElement>(`[data-tabs-panels="${scope}"]`);
  if (!panels) return;
  for (const panel of panels.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
    panel.hidden = panel.dataset.tabPanel !== key;
  }
}

function handleFilter(btn: HTMLElement): void {
  const bar = btn.closest<HTMLElement>('[data-tabs-scope]');
  const scope = bar?.dataset.tabsScope;
  const key = btn.dataset.filterBtn;
  if (!bar || !scope || !key) return;

  for (const b of bar.querySelectorAll<HTMLElement>('[data-filter-btn]')) {
    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
  }
  const grid = document.querySelector<HTMLElement>(`[data-filter-scope="${scope}"]`);
  if (!grid) return;
  for (const item of grid.querySelectorAll<HTMLElement>('[data-cat]')) {
    item.hidden = key !== 'all' && item.dataset.cat !== key;
  }
}

document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const share = target.closest<HTMLElement>('[data-share]');
  if (share) {
    handleShare(share);
    return;
  }
  const tab = target.closest<HTMLElement>('[data-tab]');
  if (tab) {
    handleTab(tab);
    return;
  }
  const filter = target.closest<HTMLElement>('[data-filter-btn]');
  if (filter) {
    handleFilter(filter);
  }
});

export {};

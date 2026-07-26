/**
 * remark 插件：构建时统计正文字数（中文按字、西文按词），
 * 注入 remarkPluginFrontmatter 的 words / readingMinutes 字段。
 * 不依赖 mdast-util-to-string，自行遍历文本节点。
 */

/** @param {any} node @returns {string} */
function collectText(node) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
    return node.value ?? '';
  }
  if (Array.isArray(node.children)) {
    return node.children.map(collectText).join('\n');
  }
  return '';
}

/** @param {string} text @returns {number} */
export function countWords(text) {
  const cjk = text.match(/[一-鿿㐀-䶿぀-ヿ]/g)?.length ?? 0;
  const latinWords =
    text
      .replace(/[一-鿿㐀-䶿぀-ヿ]/g, ' ')
      .match(/[A-Za-z0-9][A-Za-z0-9'-]*/g)?.length ?? 0;
  return cjk + latinWords;
}

export function remarkWordCount() {
  /** @param {any} tree @param {any} file */
  return (tree, file) => {
    const words = countWords(collectText(tree));
    const frontmatter = file.data.astro?.frontmatter;
    if (frontmatter) {
      frontmatter.words = words;
      // 中文阅读速度约 400 字/分钟
      frontmatter.readingMinutes = Math.max(1, Math.round(words / 400));
    }
  };
}

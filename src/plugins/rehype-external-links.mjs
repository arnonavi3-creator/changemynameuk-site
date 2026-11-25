// Adds rel="noopener" to links that leave the site (as the hand-written pages did).
export default function rehypeExternalLinks() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.tagName === 'a' && /^https?:\/\//.test(node.properties?.href ?? '')) {
        node.properties.rel = ['noopener'];
      }
      (node.children ?? []).forEach(visit);
    };
    visit(tree);
  };
}

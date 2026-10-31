/** Preserve model text; normalize only its string/array representation for section rendering. */
export function packagingTextItems(value) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim());
  return [];
}

export function packagingSectionItems(packaging = {}) {
  return [
    ...packagingTextItems(packaging.description),
    ...packagingTextItems(packaging.materials).map(text => `材料：${text}`),
    ...packagingTextItems(packaging.steps).map((text, i) => `步骤 ${i + 1}：${text}`),
  ];
}

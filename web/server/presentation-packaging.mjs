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

/** Render the content chosen by the model; this does not classify the gift or infer materials. */
export function packagingSections(packaging = {}) {
  const items = packagingSectionItems(packaging);
  if (!items.length) return [];
  const hasInstructions = packagingTextItems(packaging.materials).length > 0 || packagingTextItems(packaging.steps).length > 0;
  return [{ key: 'packaging', title: hasInstructions ? '② 包装材料与步骤' : '② 包装说明', items }];
}

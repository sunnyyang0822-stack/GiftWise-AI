// Foreign practice sites are not domestic business data sources and never launch a browser.
export class OpenCliDemoProvider {
  async search() { return { status: 'unavailable', evidence_id: null, products: [], warnings: ['公开练习来源已退出业务检索；可继续由模型提供建议'], recommendations_available: true, enrichment_only: true }; }
}
